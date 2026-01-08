# aether — Master Plan

**Version:** 1.0
**Last Updated:** January 2025

---

## Executive Summary

aether is an agent-agnostic cloud development environment. Users get instant cloud VMs they can access via browser or connect their preferred coding agent (Claude Code, Codex, etc.). Think "Replit, but you bring your own AI."

**Timeline:** 10 weeks to launch
**Estimated effort:** ~298 hours
**Team:** 2 engineers (Pranav + Praveer)

---

## Vision

**Short-term (Launch):** The fastest way to spin up a cloud dev environment and connect your coding agent.

**Medium-term (6 months):** The default environment for AI-assisted coding. Deep integrations with major agents, collaborative features, PR review environments.

**Long-term (2+ years):** The infrastructure layer for AI software development. APIs for agent orchestration, enterprise features, self-hosted option.

---

## Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              aether ROADMAP                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PHASE 1          PHASE 2          PHASE 3          PHASE 4          PHASE 5
│  Weeks 1-2        Weeks 3-4        Weeks 5-6        Weeks 7-8        Weeks 9-10
│  ─────────        ─────────        ─────────        ─────────        ─────────
│                                                                         │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  │   VM    │      │  Auth   │      │ Editor  │      │ Agents  │      │ Billing │
│  │ + Term  │ ───► │ + CRUD  │ ───► │ + Files │ ───► │ + SSH   │ ───► │ + Launch│
│  └─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘
│                                                                         │
│  Deliverables:    Deliverables:    Deliverables:    Deliverables:    Deliverables:
│  • Fly Machines   • Supabase auth  • CodeMirror     • SSH keys       • Usage track
│  • SSH proxy      • User/Project   • File tree      • Agent tokens   • Stripe
│  • xterm.js       • React app      • SFTP backend   • Activity view  • Limits
│  • Basic UI       • Terminal page  • Fly Volumes    • Setup guides   • Dashboard
│                                    • Port forward                    • Landing
│                                                                         │
│  ~54 hours        ~59 hours        ~63 hours        ~54 hours        ~68 hours
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React + TypeScript + Vite | Fast builds, type safety, familiar |
| **Styling** | Tailwind CSS | Rapid iteration, consistent design |
| **Editor** | CodeMirror 6 | Lightweight, extensible, mobile-friendly |
| **Terminal** | xterm.js | Industry standard, WebGL rendering |
| **Backend** | Go + Chi | Excellent concurrency, single binary, fast |
| **Database** | Supabase (Postgres) | Auth + DB + Realtime, minimal ops |
| **Compute** | Fly Machines | Fast boot, global regions, simple API |
| **Storage** | Fly Volumes | Persistent, attached to machines |
| **Payments** | Stripe | Industry standard, handles complexity |
| **Monitoring** | Sentry + Plausible | Error tracking + privacy-friendly analytics |

---

## Monorepo Structure

```
aether/
│
├── README.md                      # Project overview, setup instructions
├── LICENSE                        # MIT or proprietary
├── .gitignore
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # Lint, test, build on PR
│   │   ├── deploy-backend.yml     # Deploy backend to Fly
│   │   └── deploy-frontend.yml    # Deploy frontend to Vercel/Fly
│   └── CODEOWNERS
│
├── package.json                   # Root package.json for workspace scripts
├── pnpm-workspace.yaml            # pnpm workspace config
├── turbo.json                     # Turborepo config (optional)
│
│
│   ══════════════════════════════════════════════════════════════════
│   APPLICATIONS
│   ══════════════════════════════════════════════════════════════════
│
├── apps/
│   │
│   ├── backend/                   # Go backend service
│   │   ├── main.go                # Entry point
│   │   ├── go.mod
│   │   ├── go.sum
│   │   ├── Dockerfile
│   │   ├── fly.toml               # Fly.io deployment config
│   │   │
│   │   ├── cmd/
│   │   │   └── server/
│   │   │       └── main.go        # Server startup
│   │   │
│   │   ├── internal/
│   │   │   ├── config/
│   │   │   │   └── config.go      # Environment config
│   │   │   │
│   │   │   ├── handlers/
│   │   │   │   ├── health.go      # Health check endpoint
│   │   │   │   ├── projects.go    # Project CRUD (Phase 2)
│   │   │   │   ├── terminal.go    # WebSocket terminal (Phase 1)
│   │   │   │   ├── files.go       # File operations (Phase 3)
│   │   │   │   ├── agents.go      # Agent tokens (Phase 4)
│   │   │   │   └── billing.go     # Billing endpoints (Phase 5)
│   │   │   │
│   │   │   ├── middleware/
│   │   │   │   ├── auth.go        # JWT validation (Phase 2)
│   │   │   │   ├── cors.go        # CORS handling
│   │   │   │   └── logging.go     # Request logging
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── fly/
│   │   │   │   │   ├── client.go  # Fly API client
│   │   │   │   │   ├── machines.go# Machine operations
│   │   │   │   │   └── volumes.go # Volume operations (Phase 3)
│   │   │   │   │
│   │   │   │   ├── ssh/
│   │   │   │   │   ├── client.go  # SSH connection manager
│   │   │   │   │   ├── pool.go    # Connection pooling
│   │   │   │   │   └── sftp.go    # SFTP operations (Phase 3)
│   │   │   │   │
│   │   │   │   ├── db/
│   │   │   │   │   ├── client.go  # Postgres client
│   │   │   │   │   ├── projects.go# Project queries
│   │   │   │   │   ├── agents.go  # Agent token queries (Phase 4)
│   │   │   │   │   └── usage.go   # Usage tracking (Phase 5)
│   │   │   │   │
│   │   │   │   ├── crypto/
│   │   │   │   │   └── keys.go    # SSH key generation (Phase 4)
│   │   │   │   │
│   │   │   │   └── stripe/
│   │   │   │       ├── client.go  # Stripe client (Phase 5)
│   │   │   │       └── webhooks.go# Webhook handlers (Phase 5)
│   │   │   │
│   │   │   └── models/
│   │   │       ├── project.go
│   │   │       ├── user.go
│   │   │       ├── agent.go       # Phase 4
│   │   │       └── usage.go       # Phase 5
│   │   │
│   │   └── pkg/                   # Shared utilities (if needed)
│   │       └── errors/
│   │           └── errors.go
│   │
│   │
│   ├── web/                       # React frontend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── index.html
│   │   │
│   │   ├── public/
│   │   │   ├── favicon.ico
│   │   │   └── robots.txt
│   │   │
│   │   └── src/
│   │       ├── main.tsx           # Entry point
│   │       ├── App.tsx            # Router setup
│   │       ├── vite-env.d.ts
│   │       │
│   │       ├── components/
│   │       │   ├── ui/            # Generic UI components
│   │       │   │   ├── Button.tsx
│   │       │   │   ├── Input.tsx
│   │       │   │   ├── Modal.tsx
│   │       │   │   ├── Dropdown.tsx
│   │       │   │   └── ...
│   │       │   │
│   │       │   ├── layout/
│   │       │   │   ├── Header.tsx
│   │       │   │   ├── Sidebar.tsx
│   │       │   │   └── Layout.tsx
│   │       │   │
│   │       │   ├── auth/          # Phase 2
│   │       │   │   ├── AuthForm.tsx
│   │       │   │   ├── AuthGuard.tsx
│   │       │   │   └── UserMenu.tsx
│   │       │   │
│   │       │   ├── projects/      # Phase 2
│   │       │   │   ├── ProjectCard.tsx
│   │       │   │   ├── ProjectList.tsx
│   │       │   │   ├── CreateProjectModal.tsx
│   │       │   │   └── ProjectSettings.tsx
│   │       │   │
│   │       │   ├── workspace/     # Phase 1, 3
│   │       │   │   ├── Workspace.tsx
│   │       │   │   ├── Terminal.tsx
│   │       │   │   ├── Editor.tsx         # Phase 3
│   │       │   │   ├── EditorTabs.tsx     # Phase 3
│   │       │   │   ├── FileTree.tsx       # Phase 3
│   │       │   │   ├── FileTreeItem.tsx   # Phase 3
│   │       │   │   ├── PreviewButton.tsx  # Phase 3
│   │       │   │   └── StatusBar.tsx
│   │       │   │
│   │       │   ├── agents/        # Phase 4
│   │       │   │   ├── AgentModal.tsx
│   │       │   │   ├── AgentList.tsx
│   │       │   │   ├── AgentTerminal.tsx
│   │       │   │   └── AgentGuides.tsx
│   │       │   │
│   │       │   └── billing/       # Phase 5
│   │       │       ├── UsageBar.tsx
│   │       │       ├── UsageDashboard.tsx
│   │       │       ├── UpgradeModal.tsx
│   │       │       ├── PlanBadge.tsx
│   │       │       └── LimitWarning.tsx
│   │       │
│   │       ├── pages/
│   │       │   ├── Landing.tsx        # Phase 5
│   │       │   ├── Login.tsx          # Phase 2
│   │       │   ├── Signup.tsx         # Phase 2
│   │       │   ├── Projects.tsx       # Phase 2
│   │       │   ├── Workspace.tsx      # Phase 1, 3, 4
│   │       │   ├── Settings.tsx       # Phase 2
│   │       │   └── Billing.tsx        # Phase 5
│   │       │
│   │       ├── hooks/
│   │       │   ├── useAuth.ts         # Phase 2
│   │       │   ├── useProjects.ts     # Phase 2
│   │       │   ├── useTerminal.ts     # Phase 1
│   │       │   ├── useFiles.ts        # Phase 3
│   │       │   ├── useEditor.ts       # Phase 3
│   │       │   ├── useAgents.ts       # Phase 4
│   │       │   └── useUsage.ts        # Phase 5
│   │       │
│   │       ├── lib/
│   │       │   ├── supabase.ts        # Supabase client
│   │       │   ├── api.ts             # Backend API client
│   │       │   └── utils.ts           # Helpers
│   │       │
│   │       ├── stores/                # If using Zustand
│   │       │   ├── authStore.ts
│   │       │   ├── projectStore.ts
│   │       │   └── workspaceStore.ts
│   │       │
│   │       └── styles/
│   │           └── globals.css
│   │
│   │
│   └── landing/                   # Marketing site (Phase 5)
│       ├── package.json           # Could be same as web or separate
│       ├── ...                    # Astro, Next.js, or plain HTML
│       └── src/
│           ├── pages/
│           │   ├── index.astro    # Home
│           │   ├── pricing.astro  # Pricing
│           │   └── docs/          # Documentation
│           └── ...
│
│
│   ══════════════════════════════════════════════════════════════════
│   PACKAGES (shared code)
│   ══════════════════════════════════════════════════════════════════
│
├── packages/
│   │
│   ├── types/                     # Shared TypeScript types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── project.ts
│   │       ├── user.ts
│   │       ├── agent.ts
│   │       └── api.ts             # API request/response types
│   │
│   ├── ui/                        # Shared UI components (optional)
│   │   ├── package.json
│   │   └── src/
│   │       └── ...
│   │
│   └── config/                    # Shared configs
│       ├── eslint/
│       │   └── index.js
│       ├── typescript/
│       │   └── base.json
│       └── tailwind/
│           └── preset.js
│
│
│   ══════════════════════════════════════════════════════════════════
│   INFRASTRUCTURE
│   ══════════════════════════════════════════════════════════════════
│
├── infra/
│   │
│   ├── images/                    # Docker images for VMs
│   │   └── base/
│   │       ├── Dockerfile
│   │       ├── tmux.conf          # Phase 4
│   │       └── scripts/
│   │           └── setup.sh
│   │
│   ├── terraform/                 # Infrastructure as code (optional)
│   │   ├── main.tf
│   │   ├── fly.tf
│   │   └── supabase.tf
│   │
│   └── scripts/
│       ├── build-image.sh         # Build and push VM image
│       ├── deploy.sh              # Deploy all services
│       └── seed-db.sh             # Seed database for dev
│
│
│   ══════════════════════════════════════════════════════════════════
│   DATABASE
│   ══════════════════════════════════════════════════════════════════
│
├── supabase/
│   ├── config.toml                # Supabase local config
│   │
│   ├── migrations/
│   │   ├── 20240101000000_initial_schema.sql      # Phase 2
│   │   ├── 20240101000001_agent_tokens.sql        # Phase 4
│   │   └── 20240101000002_usage_billing.sql       # Phase 5
│   │
│   ├── seed.sql                   # Dev seed data
│   │
│   └── functions/                 # Edge functions (if needed)
│       └── ...
│
│
│   ══════════════════════════════════════════════════════════════════
│   DOCUMENTATION
│   ══════════════════════════════════════════════════════════════════
│
├── docs/
│   ├── README.md                  # Docs index
│   │
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   └── infrastructure.md
│   │
│   ├── api/
│   │   ├── authentication.md
│   │   ├── projects.md
│   │   ├── files.md
│   │   ├── agents.md
│   │   └── billing.md
│   │
│   ├── guides/
│   │   ├── getting-started.md
│   │   ├── connecting-claude-code.md
│   │   ├── connecting-codex.md
│   │   └── self-hosting.md        # Future
│   │
│   └── prd/
│       ├── phase1-infrastructure.md
│       ├── phase2-product.md
│       ├── phase3-editor.md
│       ├── phase4-agents.md
│       └── phase5-billing.md
│
│
│   ══════════════════════════════════════════════════════════════════
│   TOOLING
│   ══════════════════════════════════════════════════════════════════
│
├── .vscode/
│   ├── settings.json
│   ├── extensions.json
│   └── launch.json                # Debug configs
│
├── .env.example                   # Environment template
├── .env.local                     # Local overrides (gitignored)
│
└── Makefile                       # Common commands
    # make dev        - Start all services
    # make test       - Run all tests
    # make build      - Build all apps
    # make deploy     - Deploy to production
    # make db-migrate - Run migrations
    # make image      - Build VM image
```

---

## Service Architecture

```
                                    ┌─────────────────────┐
                                    │                     │
                                    │   Cloudflare CDN    │
                                    │                     │
                                    └──────────┬──────────┘
                                               │
                     ┌─────────────────────────┼─────────────────────────┐
                     │                         │                         │
                     ▼                         ▼                         ▼
           ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
           │                 │       │                 │       │                 │
           │   Landing Site  │       │    Web App      │       │   API Backend   │
           │   (Vercel)      │       │   (Vercel)      │       │   (Fly.io)      │
           │                 │       │                 │       │                 │
           │   marketing     │       │   app.aether.dev │       │   api.aether.dev │
           │   aether.dev     │       │                 │       │                 │
           └─────────────────┘       └────────┬────────┘       └────────┬────────┘
                                              │                         │
                                              │    HTTP/WebSocket       │
                                              └────────────┬────────────┘
                                                           │
                                                           ▼
                                              ┌─────────────────────────┐
                                              │                         │
                                              │      Go Backend         │
                                              │                         │
                                              │  • REST API             │
                                              │  • WebSocket (terminal) │
                                              │  • Stripe webhooks      │
                                              │                         │
                                              └─────┬─────────────┬─────┘
                                                    │             │
                              ┌─────────────────────┤             │
                              │                     │             │
                              ▼                     ▼             ▼
                    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                    │                 │   │                 │   │                 │
                    │   Supabase      │   │   Fly Machines  │   │     Stripe      │
                    │                 │   │                 │   │                 │
                    │  • Auth         │   │  • User VMs     │   │  • Payments     │
                    │  • Postgres     │   │  • SSH access   │   │  • Billing      │
                    │  • Realtime     │   │  • Volumes      │   │  • Webhooks     │
                    │                 │   │                 │   │                 │
                    └─────────────────┘   └────────┬────────┘   └─────────────────┘
                                                   │
                                                   │ SSH
                                                   │
                              ┌─────────────────────────────────────────┐
                              │                                         │
                              │         User Fly Machines               │
                              │                                         │
                              │  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
                              │  │ VM 1    │  │ VM 2    │  │ VM 3    │  │
                              │  │ (user A)│  │ (user A)│  │ (user B)│  │
                              │  └─────────┘  └─────────┘  └─────────┘  │
                              │                                         │
                              │  + Attached Fly Volumes for persistence │
                              │                                         │
                              └─────────────────────────────────────────┘
```

---

## Data Flow

### User Opens Project

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Browser │     │ Web App  │     │ Backend  │     │ Supabase │     │ Fly API  │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │                │
     │  Click project │                │                │                │
     ├───────────────►│                │                │                │
     │                │  GET /projects/:id              │                │
     │                ├───────────────►│                │                │
     │                │                │  Query project │                │
     │                │                ├───────────────►│                │
     │                │                │◄───────────────┤                │
     │                │                │                │                │
     │                │                │  Check VM status                │
     │                │                ├────────────────────────────────►│
     │                │                │◄────────────────────────────────┤
     │                │                │                │                │
     │                │                │  If stopped: start machine      │
     │                │                ├────────────────────────────────►│
     │                │                │◄────────────────────────────────┤
     │                │                │                │                │
     │                │                │  Record usage start             │
     │                │                ├───────────────►│                │
     │                │                │◄───────────────┤                │
     │                │                │                │                │
     │                │◄───────────────┤ {project, terminal_url}         │
     │◄───────────────┤                │                │                │
     │                │                │                │                │
     │  Connect WebSocket to terminal  │                │                │
     ├────────────────────────────────►│                │                │
     │                │                │  SSH to VM     │                │
     │                │                ├────────────────────────────────►│
     │                │                │◄───────────────│────────────────┤
     │◄───────────────────────────────►│ Bidirectional │                │
     │           Terminal stream       │                │                │
     │                │                │                │                │
```

### Agent Connects

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Agent   │     │  Fly VM  │     │ Backend  │
│(Claude)  │     │          │     │          │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     │  SSH connect   │                │
     ├───────────────►│                │
     │                │                │
     │  (Key in authorized_keys)       │
     │◄──────────────►│                │
     │  Shell session │                │
     │                │                │
     │  Execute commands               │
     ├───────────────►│                │
     │◄───────────────┤                │
     │                │                │
     │  (User watches via tmux)        │
     │                │                │
```

---

## Environment Variables

### Backend (`apps/backend/.env`)

```bash
# Server
PORT=8080
ENV=development  # development, staging, production

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_JWT_SECRET=xxx

# Fly.io
FLY_API_TOKEN=xxx
FLY_APP_NAME=aether-vms
FLY_REGION=sjc
FLY_ORG=personal

# SSH
SSH_PRIVATE_KEY_PATH=/secrets/ssh_key
# Or: SSH_PRIVATE_KEY=base64_encoded_key

# Encryption (for agent private keys)
ENCRYPTION_MASTER_KEY=32_byte_hex_string

# Stripe (Phase 5)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_TEAM=price_xxx

# Monitoring
SENTRY_DSN=https://xxx@sentry.io/xxx
```

### Frontend (`apps/web/.env`)

```bash
# API
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080

# Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Stripe (Phase 5)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# Analytics
VITE_PLAUSIBLE_DOMAIN=aether.dev
```

---

## Database Schema Summary

### Phase 2: Core

```sql
profiles (
    id              uuid PK → auth.users
    email           text
    display_name    text
    plan            text ['free', 'pro', 'team']
    stripe_customer_id      text
    stripe_subscription_id  text
    created_at      timestamptz
    updated_at      timestamptz
)

projects (
    id              uuid PK
    user_id         uuid FK → profiles
    name            text
    description     text
    fly_machine_id  text
    fly_volume_id   text
    status          text ['stopped', 'starting', 'running', 'stopping', 'error']
    base_image      text
    env_vars        jsonb
    last_accessed_at timestamptz
    created_at      timestamptz
    updated_at      timestamptz
)
```

### Phase 4: Agents

```sql
agent_tokens (
    id                      uuid PK
    project_id              uuid FK → projects
    public_key              text
    private_key_encrypted   text
    name                    text
    last_used_at            timestamptz
    created_at              timestamptz
    expires_at              timestamptz
)
```

### Phase 5: Billing

```sql
usage_records (
    id              uuid PK
    project_id      uuid FK → projects
    user_id         uuid FK → profiles
    started_at      timestamptz
    ended_at        timestamptz
    machine_type    text
    duration_seconds int
    created_at      timestamptz
)

usage_monthly (
    id              uuid PK
    user_id         uuid FK → profiles
    month           date
    compute_seconds int
    storage_gb_hours numeric
    UNIQUE(user_id, month)
)

plan_limits (
    plan                    text PK
    compute_seconds_monthly int
    storage_gb              int
    max_projects            int
)
```

---

## API Routes Summary

### Phase 1
```
GET  /health                    Health check
WS   /terminal/:machineId       Terminal WebSocket (temporary, pre-auth)
```

### Phase 2
```
GET    /projects                List user projects
POST   /projects                Create project
GET    /projects/:id            Get project
PATCH  /projects/:id            Update project
DELETE /projects/:id            Delete project
POST   /projects/:id/start      Start project VM
POST   /projects/:id/stop       Stop project VM
WS     /projects/:id/terminal   Terminal WebSocket
```

### Phase 3
```
GET    /projects/:id/files      List directory / read file
PUT    /projects/:id/files      Write file
POST   /projects/:id/files/mkdir    Create directory
DELETE /projects/:id/files      Delete file/directory
POST   /projects/:id/files/rename   Rename/move file
```

### Phase 4
```
GET    /projects/:id/agents             List agent tokens
POST   /projects/:id/agents             Create agent token
DELETE /projects/:id/agents/:tokenId    Revoke agent token
WS     /projects/:id/agent-terminal     Agent activity stream
```

### Phase 5
```
GET    /billing/usage           Get usage summary
POST   /billing/checkout        Create Stripe checkout session
POST   /billing/portal          Create Stripe portal session
POST   /billing/webhook         Handle Stripe webhooks
```

---

## Development Workflow

### Local Development

```bash
# Terminal 1: Backend
cd apps/backend
go run cmd/server/main.go

# Terminal 2: Frontend
cd apps/web
pnpm dev

# Terminal 3: Supabase (local)
supabase start
```

### Common Commands (Makefile)

```makefile
.PHONY: dev test build deploy

# Start all services for local development
dev:
	@echo "Starting Supabase..."
	cd supabase && supabase start
	@echo "Starting backend..."
	cd apps/backend && go run cmd/server/main.go &
	@echo "Starting frontend..."
	cd apps/web && pnpm dev

# Run all tests
test:
	cd apps/backend && go test ./...
	cd apps/web && pnpm test

# Build all applications
build:
	cd apps/backend && go build -o bin/server cmd/server/main.go
	cd apps/web && pnpm build

# Deploy to production
deploy:
	cd apps/backend && fly deploy
	cd apps/web && vercel --prod

# Database migrations
db-migrate:
	cd supabase && supabase db push

# Build and push VM image
image:
	cd infra/images/base && docker build -t registry.fly.io/aether-vms/base:latest .
	docker push registry.fly.io/aether-vms/base:latest
```

---

## Deployment

### Backend (Fly.io)

```toml
# apps/backend/fly.toml
app = "aether-api"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

### Frontend (Vercel)

```json
// apps/web/vercel.json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

### VM Image (Fly Registry)

```bash
# Build and push
cd infra/images/base
docker build -t registry.fly.io/aether-vms/base:latest .
fly auth docker
docker push registry.fly.io/aether-vms/base:latest
```

---

## Timeline Summary

| Week | Phase | Focus | Key Deliverables |
|------|-------|-------|------------------|
| 1 | 1 | Infrastructure | Fly Machine orchestration, base image |
| 2 | 1 | Infrastructure | Terminal proxy, xterm.js UI |
| 3 | 2 | Product | Supabase setup, auth, database schema |
| 4 | 2 | Product | Project CRUD, React app, workspace page |
| 5 | 3 | Editor | SFTP backend, file tree component |
| 6 | 3 | Editor | CodeMirror integration, port forwarding |
| 7 | 4 | Agents | SSH key generation, agent tokens |
| 8 | 4 | Agents | Connection UI, activity monitoring |
| 9 | 5 | Billing | Usage tracking, Stripe integration |
| 10 | 5 | Launch | Polish, landing page, monitoring |

---

## Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|------------|-------|
| Fly API instability | Low | High | Error handling, retries, fallback messaging | — |
| Usage tracking gaps | Medium | High | Reconciliation cron, Fly API as source of truth | — |
| SSH key security breach | Low | Critical | Encryption at rest, audit logging, rotation | — |
| Free tier abuse | High | Medium | Rate limiting, IP blocking, manual review | — |
| Scope creep | High | Medium | Strict phase boundaries, defer to backlog | — |
| Performance issues | Medium | Medium | Load testing, monitoring, optimization sprints | — |

---

## Success Metrics

### Launch (Week 10)
- [ ] 100 signups in first week
- [ ] 10 paying customers in first month
- [ ] <1% error rate
- [ ] 99.5% uptime

### Month 1
- [ ] 500 total users
- [ ] 50 paying customers
- [ ] $1,000 MRR
- [ ] NPS > 40

### Month 3
- [ ] 2,000 total users
- [ ] 200 paying customers
- [ ] $5,000 MRR
- [ ] Featured in relevant communities

---

## Next Steps

1. **Today:** Set up monorepo structure, initialize all packages
2. **This week:** Complete Phase 1 (VM + terminal working)
3. **Ongoing:** Daily standups, weekly phase reviews
4. **Pre-launch:** Beta users for feedback, fix critical issues

---

## Appendix: Links

- [Phase 1 PRD](./prd/phase1-infrastructure.md)
- [Phase 2 PRD](./prd/phase2-product.md)
- [Phase 3 PRD](./prd/phase3-editor.md)
- [Phase 4 PRD](./prd/phase4-agents.md)
- [Phase 5 PRD](./prd/phase5-billing.md)
- [Fly Machines API Docs](https://fly.io/docs/machines/)
- [Supabase Docs](https://supabase.com/docs)
- [Stripe Docs](https://stripe.com/docs)
