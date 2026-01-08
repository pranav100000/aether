# Phase 5 PRD: Billing & Launch

**Project:** aether (working title)
**Phase:** 5 of 5
**Timeline:** Weeks 9-10
**Goal:** Make it sustainable — add usage tracking, billing, and polish for public launch

---

## Overview

We have a working product. Phase 5 makes it a business. By the end of this phase:

1. Usage is tracked (compute minutes per project)
2. Users can subscribe and pay
3. Free tier limits are enforced
4. The product is polished enough for public launch
5. Basic analytics and monitoring are in place

This phase transforms aether from a side project into something that can sustain itself.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Billing accuracy | 100% — no missed usage, no overcharges |
| Payment success rate | >95% of attempted charges succeed |
| Free tier abuse | <5% of free users hitting limits repeatedly |
| Page load time | <2 seconds for dashboard |
| Error rate | <0.1% of requests fail |
| Uptime | 99.5% during launch week |

---

## Technical Requirements

### 1. Usage Tracking

Track compute time for billing purposes.

**What to track:**
- VM running time (per project, per minute)
- Storage used (per project, in GB)
- Bandwidth (stretch — skip for v1)

**Database schema:**

```sql
create table usage_records (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    user_id uuid not null references profiles(id),
    
    -- Time range
    started_at timestamptz not null,
    ended_at timestamptz,
    
    -- Compute
    machine_type text not null default 'shared-cpu-1x',
    duration_seconds int,  -- computed on end
    
    -- Metadata
    created_at timestamptz default now()
);

create index usage_records_user_id_idx on usage_records(user_id);
create index usage_records_project_id_idx on usage_records(project_id);
create index usage_records_started_at_idx on usage_records(started_at);

-- Monthly aggregates for quick billing lookups
create table usage_monthly (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id),
    month date not null,  -- first of month
    
    compute_seconds int default 0,
    storage_gb_hours numeric(10,2) default 0,
    
    unique(user_id, month)
);

create index usage_monthly_user_month_idx on usage_monthly(user_id, month);
```

**Tracking flow:**

```
VM starts
    ↓
Insert usage_record (started_at = now, ended_at = null)
    ↓
VM stops (or idle timeout)
    ↓
Update usage_record (ended_at = now, duration_seconds = diff)
    ↓
Update usage_monthly aggregate
```

**Backend implementation:**

```go
// On VM start
func (s *Service) StartProject(projectID string) error {
    // ... start VM ...
    
    // Record usage start
    _, err := s.db.Exec(`
        INSERT INTO usage_records (project_id, user_id, started_at, machine_type)
        VALUES ($1, $2, NOW(), $3)
    `, projectID, userID, machineType)
    
    return err
}

// On VM stop
func (s *Service) StopProject(projectID string) error {
    // ... stop VM ...
    
    // Record usage end
    _, err := s.db.Exec(`
        UPDATE usage_records 
        SET ended_at = NOW(), 
            duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))
        WHERE project_id = $1 AND ended_at IS NULL
    `, projectID)
    
    // Update monthly aggregate
    _, err = s.db.Exec(`
        INSERT INTO usage_monthly (user_id, month, compute_seconds)
        VALUES ($1, DATE_TRUNC('month', NOW()), $2)
        ON CONFLICT (user_id, month) 
        DO UPDATE SET compute_seconds = usage_monthly.compute_seconds + $2
    `, userID, durationSeconds)
    
    return err
}
```

**Edge cases:**
- VM crashes without clean stop → cron job finds orphaned records, ends them
- Backend restarts → on startup, reconcile with Fly API
- Clock skew → use database time (NOW()), not application time

**Acceptance criteria:**
- Every VM start creates a usage record
- Every VM stop closes the usage record
- Monthly aggregates are accurate
- Orphaned records are cleaned up within 1 hour

---

### 2. Pricing Model

Simple, predictable pricing.

**Tiers:**

| Tier | Price | Compute | Storage | Projects |
|------|-------|---------|---------|----------|
| Free | $0/mo | 50 hours/mo | 1 GB | 3 |
| Pro | $20/mo | 200 hours/mo | 10 GB | 20 |
| Team | $50/mo | 500 hours/mo | 50 GB | Unlimited |

**Overage (Pro and Team only):**
- Compute: $0.10 per additional hour
- Storage: $0.50 per additional GB/month

**Free tier limits:**
- Hard cap on compute (VM won't start if limit reached)
- Hard cap on projects (can't create more)
- Soft cap on storage (warning, then block new files)

**Database schema:**

```sql
-- Add to profiles
alter table profiles add column plan text default 'free' 
    check (plan in ('free', 'pro', 'team'));
alter table profiles add column stripe_customer_id text;
alter table profiles add column stripe_subscription_id text;

-- Plan limits reference
create table plan_limits (
    plan text primary key,
    compute_seconds_monthly int not null,
    storage_gb int not null,
    max_projects int not null
);

insert into plan_limits values
    ('free', 180000, 1, 3),      -- 50 hours
    ('pro', 720000, 10, 20),     -- 200 hours
    ('team', 1800000, 50, 1000); -- 500 hours
```

**Acceptance criteria:**
- Plan limits are enforced
- Free users can't exceed limits
- Pro/Team users get overage charged
- Clear messaging when limits approached/reached

---

### 3. Stripe Integration

Handle payments via Stripe.

**Stripe products to create:**
- Product: "aether Pro" ($20/mo)
- Product: "aether Team" ($50/mo)
- Metered price for compute overage
- Metered price for storage overage

**Integration points:**

1. **Checkout** — User upgrades, redirect to Stripe Checkout
2. **Portal** — User manages subscription via Stripe Customer Portal
3. **Webhooks** — Handle subscription changes, payment failures

**API endpoints:**

```
POST /billing/checkout          Create Stripe Checkout session
POST /billing/portal            Create Stripe Portal session
POST /billing/webhook           Handle Stripe webhooks (public)
GET  /billing/usage             Get current usage summary
```

**Checkout flow:**

```
User clicks "Upgrade to Pro"
    ↓
POST /billing/checkout {plan: "pro"}
    ↓
Backend creates Stripe Checkout Session
    ↓
Return checkout URL
    ↓
Frontend redirects to Stripe
    ↓
User completes payment
    ↓
Stripe redirects to success URL
    ↓
Webhook fires: checkout.session.completed
    ↓
Backend updates user plan + stripe IDs
```

**Webhook events to handle:**

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Update user plan, store Stripe IDs |
| `customer.subscription.updated` | Sync plan changes |
| `customer.subscription.deleted` | Downgrade to free |
| `invoice.paid` | Record successful payment |
| `invoice.payment_failed` | Notify user, grace period |

**Overage reporting:**

At end of each billing period, report metered usage to Stripe:

```go
// Cron job: daily or end of billing period
func (s *Service) ReportUsageToStripe(userID string) error {
    usage, _ := s.GetMonthlyUsage(userID)
    limits, _ := s.GetPlanLimits(userID)
    
    overageSeconds := max(0, usage.ComputeSeconds - limits.ComputeSeconds)
    overageHours := overageSeconds / 3600
    
    if overageHours > 0 {
        stripe.UsageRecords.New(&stripe.UsageRecordParams{
            SubscriptionItem: user.StripeComputeItemID,
            Quantity: overageHours,
            Timestamp: time.Now().Unix(),
        })
    }
    
    return nil
}
```

**Acceptance criteria:**
- Can upgrade from free to Pro/Team
- Stripe Checkout works correctly
- Webhooks update user plan
- Can access Customer Portal to manage subscription
- Overage is reported and charged correctly
- Payment failures trigger notification

---

### 4. Limit Enforcement

Prevent free users from exceeding limits.

**Compute limits:**

```go
func (s *Service) StartProject(projectID string) error {
    user := s.GetUser(userID)
    usage := s.GetMonthlyUsage(userID)
    limits := s.GetPlanLimits(user.Plan)
    
    if usage.ComputeSeconds >= limits.ComputeSeconds && user.Plan == "free" {
        return ErrComputeLimitReached
    }
    
    // ... proceed with start ...
}
```

**Project limits:**

```go
func (s *Service) CreateProject(userID string, name string) error {
    user := s.GetUser(userID)
    projectCount := s.CountProjects(userID)
    limits := s.GetPlanLimits(user.Plan)
    
    if projectCount >= limits.MaxProjects {
        return ErrProjectLimitReached
    }
    
    // ... proceed with create ...
}
```

**Storage limits:**

```go
func (s *Service) WriteFile(projectID string, path string, content []byte) error {
    user := s.GetProjectOwner(projectID)
    storageUsed := s.GetTotalStorageGB(userID)
    limits := s.GetPlanLimits(user.Plan)
    
    if storageUsed >= limits.StorageGB && user.Plan == "free" {
        return ErrStorageLimitReached
    }
    
    // ... proceed with write ...
}
```

**UI feedback:**

- Show usage bar in dashboard header
- Warning banner at 80% usage
- Error modal when limit reached with upgrade CTA

**Acceptance criteria:**
- Free users can't start VM when compute exhausted
- Free users can't create projects beyond limit
- Free users see clear error with upgrade option
- Pro/Team users can exceed (overage charged)

---

### 5. Usage Dashboard

Show users their usage and billing status.

**Dashboard UI:**

```
┌─────────────────────────────────────────────────────────────────┐
│  🔨 aether                                    [user@email ▼]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Plan: Free                              [Upgrade to Pro →]     │
│                                                                 │
│  This Month's Usage                                             │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  Compute        ████████████░░░░░░░░  42/50 hours (84%)        │
│  Storage        ██░░░░░░░░░░░░░░░░░░  0.2/1 GB (20%)           │
│  Projects       ██████░░░░░░░░░░░░░░  2/3                      │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  Usage History                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Jan 2024    45 hours    $0.00                            │  │
│  │  Dec 2023    38 hours    $0.00                            │  │
│  │  Nov 2023    52 hours    $0.20 (2hr overage)              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Manage Subscription]   [View Invoices]                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**API endpoint:**

```
GET /billing/usage

Response 200:
{
  "plan": "free",
  "period_start": "2024-01-01",
  "period_end": "2024-01-31",
  "limits": {
    "compute_hours": 50,
    "storage_gb": 1,
    "max_projects": 3
  },
  "usage": {
    "compute_hours": 42.5,
    "storage_gb": 0.2,
    "project_count": 2
  },
  "history": [
    {"month": "2024-01", "compute_hours": 42.5, "cost": 0},
    {"month": "2023-12", "compute_hours": 38, "cost": 0}
  ]
}
```

**Acceptance criteria:**
- Dashboard shows current plan
- Usage bars show consumption vs limits
- Warning state at 80%+
- History shows past months
- Links to Stripe portal work

---

### 6. Launch Polish

Final cleanup for public launch.

**Error handling:**
- All API errors return consistent format
- Frontend shows friendly error messages
- Sentry integration for error tracking

**Loading states:**
- Skeleton loaders for dashboard
- Progress indicators for VM start
- Optimistic updates where safe

**Empty states:**
- No projects: "Create your first project" CTA
- No usage: "Start building to see usage"

**Onboarding:**
- Welcome modal for new users
- Quick tour of workspace (optional)
- Link to documentation

**Performance:**
- Lazy load workspace components
- Code split by route
- Compress assets

**SEO/Marketing:**
- Landing page with value proposition
- Pricing page
- Documentation site (basic)

**Legal:**
- Terms of Service
- Privacy Policy
- Cookie notice (if needed)

**Monitoring:**
- Uptime monitoring (e.g., Checkly, UptimeRobot)
- Error tracking (Sentry)
- Basic analytics (Plausible or PostHog)
- Fly.io metrics dashboard

**Acceptance criteria:**
- No console errors in production
- All error states have user-friendly messages
- Loading states feel responsive
- Landing page explains the product
- Legal pages exist

---

## File Structure Updates

```
aether/
├── backend/
│   ├── handlers/
│   │   ├── billing.go           # NEW: Stripe endpoints
│   │   ├── usage.go             # NEW: Usage tracking
│   │   └── ...
│   ├── stripe/
│   │   ├── client.go            # NEW: Stripe API wrapper
│   │   └── webhooks.go          # NEW: Webhook handlers
│   ├── billing/
│   │   ├── limits.go            # NEW: Limit enforcement
│   │   └── usage.go             # NEW: Usage aggregation
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── UsageBar.tsx          # NEW
│   │   │   ├── UsageDashboard.tsx    # NEW
│   │   │   ├── PlanBadge.tsx         # NEW
│   │   │   ├── UpgradeModal.tsx      # NEW
│   │   │   ├── LimitWarning.tsx      # NEW
│   │   │   └── ...
│   │   ├── pages/
│   │   │   ├── Billing.tsx           # NEW
│   │   │   ├── Landing.tsx           # NEW
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── marketing/
│   ├── landing/                 # NEW: Landing page
│   ├── docs/                    # NEW: Documentation
│   └── legal/                   # NEW: ToS, Privacy
└── ...
```

---

## Dependencies

**Backend (new):**
- `github.com/stripe/stripe-go/v76` — Stripe SDK

**Frontend (new):**
- `@stripe/stripe-js` — Stripe.js for Checkout redirect

**Services:**
- Stripe account (test + live keys)
- Sentry account (error tracking)
- Plausible/PostHog (analytics)
- UptimeRobot (monitoring)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Billing bugs (overcharge) | Medium | High | Extensive testing, manual review first month |
| Billing bugs (undercharge) | Medium | Medium | Usage reconciliation cron, alerts |
| Stripe webhook failures | Low | High | Webhook retry, idempotency, manual fallback |
| Free tier abuse | High | Medium | Rate limiting, manual review, IP blocking |
| VM usage not tracked | Medium | High | Reconciliation job, Fly API as source of truth |

---

## Out of Scope for Phase 5

- Annual billing discount — Future
- Team billing (multiple seats) — Future
- Usage alerts/notifications — Future
- Referral program — Future
- Enterprise plan — Future

---

## Task Breakdown

### Week 9

| Task | Estimate | Owner |
|------|----------|-------|
| Database: usage_records, usage_monthly tables | 2 hours | — |
| Database: plan_limits, profile updates | 2 hours | — |
| Backend: Usage tracking on VM start/stop | 4 hours | — |
| Backend: Monthly aggregation logic | 3 hours | — |
| Backend: Orphan usage record cleanup cron | 2 hours | — |
| Backend: Plan limit enforcement | 4 hours | — |
| Stripe: Create products and prices | 2 hours | — |
| Backend: Stripe checkout endpoint | 4 hours | — |
| Backend: Stripe portal endpoint | 2 hours | — |
| Backend: Stripe webhook handler | 5 hours | — |

### Week 10

| Task | Estimate | Owner |
|------|----------|-------|
| Frontend: Usage dashboard page | 5 hours | — |
| Frontend: Usage bars component | 2 hours | — |
| Frontend: Upgrade modal | 3 hours | — |
| Frontend: Limit warning banners | 2 hours | — |
| Frontend: Billing page (portal link, invoices) | 3 hours | — |
| Landing page | 6 hours | — |
| Documentation (basic) | 4 hours | — |
| Legal pages (ToS, Privacy) | 2 hours | — |
| Error tracking setup (Sentry) | 2 hours | — |
| Monitoring setup | 2 hours | — |
| End-to-end billing test | 3 hours | — |
| Final polish and bug fixes | 4 hours | — |

**Total estimated hours:** ~68 hours

---

## Definition of Done

Phase 5 is complete when:

1. ✅ VM usage is tracked accurately
2. ✅ Monthly usage aggregates are correct
3. ✅ Free tier limits are enforced
4. ✅ Users can upgrade via Stripe Checkout
5. ✅ Webhooks update plan status correctly
6. ✅ Users can manage subscription via Stripe Portal
7. ✅ Usage dashboard shows current consumption
8. ✅ Warning shown at 80% usage
9. ✅ Landing page exists and explains product
10. ✅ Error tracking is live
11. ✅ Monitoring is live
12. ✅ Legal pages exist

---

## Design Decisions

1. **Simple tiers:** Three tiers (Free/Pro/Team) with clear limits. No complex per-resource pricing. Users can understand their bill at a glance.

2. **Hard limits for free:** Free tier has hard caps, not soft. Prevents abuse and creates clear upgrade pressure. Pro/Team get overage instead.

3. **Stripe-managed billing:** Use Stripe Checkout and Customer Portal. Don't build custom payment forms. Less PCI scope, fewer bugs.

4. **Monthly aggregates:** Pre-compute monthly usage for fast billing lookups. Reconcile daily. Don't calculate from raw records on every request.

5. **Overage at end of period:** Report overage to Stripe at billing period end, not real-time. Simpler, fewer API calls, matches user mental model.

6. **Usage tracking in DB, not Fly:** Track usage in our database, not just Fly metrics. We own the data, can handle Fly API outages, easier to query.

---

## API Reference

**Get usage summary**
```
GET /billing/usage

Response 200:
{
  "plan": "free",
  "period": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-31T23:59:59Z"
  },
  "limits": {
    "compute_hours": 50,
    "storage_gb": 1,
    "max_projects": 3
  },
  "usage": {
    "compute_hours": 42.5,
    "compute_percent": 85,
    "storage_gb": 0.2,
    "storage_percent": 20,
    "project_count": 2
  },
  "history": [
    {
      "month": "2024-01",
      "compute_hours": 42.5,
      "storage_gb": 0.2,
      "overage_cost": 0
    }
  ]
}
```

**Create checkout session**
```
POST /billing/checkout
{
  "plan": "pro"
}

Response 200:
{
  "checkout_url": "https://checkout.stripe.com/..."
}
```

**Create portal session**
```
POST /billing/portal

Response 200:
{
  "portal_url": "https://billing.stripe.com/..."
}
```

**Stripe webhook**
```
POST /billing/webhook
Stripe-Signature: ...

(Stripe event payload)

Response 200: {"received": true}
```

---

## Launch Checklist

**Before launch:**
- [ ] Stripe live keys configured
- [ ] Webhook endpoint registered in Stripe
- [ ] Sentry DSN configured
- [ ] Monitoring alerts set up
- [ ] DNS configured for production domain
- [ ] SSL certificates valid
- [ ] Legal pages reviewed
- [ ] Test upgrade/downgrade flow
- [ ] Test limit enforcement
- [ ] Load test (basic)
- [ ] Backup strategy confirmed

**Launch day:**
- [ ] Enable Stripe live mode
- [ ] Monitor error rates
- [ ] Monitor Fly costs
- [ ] Be ready to scale if needed
- [ ] Respond to user feedback quickly

**Post-launch (week 1):**
- [ ] Review billing accuracy
- [ ] Check for orphaned VMs
- [ ] Analyze usage patterns
- [ ] Fix critical bugs immediately
- [ ] Collect user feedback
