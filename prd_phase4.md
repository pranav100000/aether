# Phase 4 PRD: Agent Integration

**Project:** aether (working title)
**Phase:** 4 of 5
**Goal:** Enable users to run coding agents (Claude Code, Codex, etc.) directly in their cloud projects

---

## Overview

This is the differentiator. Phase 4 makes aether agent-ready — users can run their preferred coding agent directly in their cloud environment with zero setup friction. By the end of this phase:

1. Users connect their API keys once (Anthropic, OpenAI, etc.)
2. Agents are pre-installed on all VMs
3. User opens terminal, runs `claude` — it just works
4. API keys are available across all projects automatically
5. We track agent usage to understand what's popular

This transforms aether from "Replit clone" to "the cloud environment for AI-assisted coding."

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Time to first agent command | <10 seconds (open terminal, run `claude`) |
| API key setup | One-time, takes <1 minute |
| Agent availability | Works in any project without per-project config |
| Supported agents | Claude Code, Codex CLI at minimum |
| Image boot time | Still <3 seconds with agents installed |

---

## Technical Requirements

### 1. User-Level API Key Storage

Allow users to store their AI provider API keys once, available across all projects.

**Approach:** Encrypted storage in user profile, injected as env vars on VM start.

**Database schema update:**

```sql
-- Add to profiles table
alter table profiles add column api_keys_encrypted text;
-- Stores encrypted JSON: {"anthropic": "sk-...", "openai": "sk-..."}
```

**Encryption approach:**
- AES-256-GCM encryption
- Master key from environment variable (`ENCRYPTION_MASTER_KEY`)
- Per-user salt derived from user ID
- Keys decrypted server-side only when needed (VM start)

**Master key management:**

```bash
# Generate a secure 32-byte (256-bit) key
openssl rand -hex 32

# Store in Fly.io secrets (encrypted at rest, injected at runtime)
fly secrets set ENCRYPTION_MASTER_KEY=<generated_key>
```

- **Storage:** Fly.io secrets (encrypted at rest, never logged)
- **Backup:** Store copy in password manager (1Password/Bitwarden) for disaster recovery
- **Per-environment:** Use different keys for dev/staging/prod
- **Future:** Implement key versioning for rotation (store key ID with encrypted data)

**API endpoints:**

```
GET  /user/api-keys          List connected providers (not the actual keys)
POST /user/api-keys          Add/update an API key
DELETE /user/api-keys/:provider   Remove an API key
```

**Example responses:**

```json
// GET /user/api-keys
{
  "providers": [
    {"provider": "anthropic", "connected": true, "added_at": "2024-01-10T..."},
    {"provider": "openai", "connected": false}
  ]
}

// POST /user/api-keys
{
  "provider": "anthropic",
  "api_key": "sk-ant-..."
}

// Response 200:
{
  "provider": "anthropic",
  "connected": true,
  "added_at": "2024-01-10T..."
}
```

**Acceptance criteria:**
- User can add API key for Anthropic, OpenAI
- Keys are encrypted at rest (AES-256-GCM)
- Can list which providers are connected (without exposing keys)
- Can remove/update keys
- Keys are never returned to frontend after initial save

---

### 2. Environment Variable Injection

Inject user's API keys into VMs on start.

**How it works:**

1. When starting a VM, backend fetches user's encrypted API keys
2. Decrypts them server-side
3. Passes them to VM as environment variables
4. VM starts with keys already in environment

**Environment variables injected:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

**Implementation:**

Update the VM start flow to:
1. Fetch user's API keys from profile
2. Decrypt them
3. Merge with project-level env vars
4. Pass combined env vars to Fly Machine

**Acceptance criteria:**
- API keys available as env vars inside VM
- Works on fresh VM start and restart
- Project env vars can override user-level keys if needed
- Keys not logged or exposed in any debugging output

---

### 3. Base Image with Pre-installed Agents

Update VM image to include coding agents and useful tools.

**Dockerfile updates:**

```dockerfile
# Development tools useful for agents
RUN apt-get update && apt-get install -y \
    tmux \
    ripgrep \
    fd-find \
    bat \
    jq \
    htop \
    tree \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Codex CLI (if available as npm package)
# RUN npm install -g @openai/codex

# Configure tmux with sensible defaults
COPY tmux.conf /home/coder/.tmux.conf
```

**tmux.conf:**
```
# Increase scrollback
set -g history-limit 50000

# Better colors
set -g default-terminal "screen-256color"

# Status bar shows session name
set -g status-left "[#S] "

# Mouse support
set -g mouse on
```

**Acceptance criteria:**
- Claude Code CLI installed and runnable
- Development tools (ripgrep, fd, bat, jq) available
- tmux configured with reasonable defaults
- Image still boots in <3 seconds

---

### 4. Agent Usage Tracking

Track which agents and models are being used for analytics.

**Approach:** Lightweight tracking via terminal output pattern matching.

**Database schema:**

```sql
create table agent_usage (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id) on delete cascade,
    project_id uuid not null references projects(id) on delete cascade,

    agent text not null,              -- 'claude', 'codex', 'aider', etc.
    model text,                       -- 'claude-sonnet-4-20250514', 'gpt-4', etc. (if detectable)

    started_at timestamptz not null default now(),
    ended_at timestamptz,

    created_at timestamptz default now()
);

create index agent_usage_user_id_idx on agent_usage(user_id);
create index agent_usage_agent_idx on agent_usage(agent);
create index agent_usage_started_at_idx on agent_usage(started_at);
```

**How tracking works:**

1. **Terminal output monitoring:** Backend already proxies terminal I/O. Add lightweight pattern matching:
   - Detect agent startup: `claude`, `codex`, `aider` commands
   - Detect model selection if visible in output (e.g., "Using claude-sonnet-4-20250514")
   - Detect session end: agent exit or new command prompt

2. **Patterns to match:**
   ```
   ^(claude|codex|aider)\s*       # Agent start
   Using (claude-[\w-]+|gpt-[\w-]+)  # Model detection (agent-specific)
   ```

3. **Record lifecycle:**
   - On agent command detected → insert row with `started_at`
   - On session end detected → update `ended_at`
   - If no end detected, leave `ended_at` null (session may have been killed)

**What we track:**
- Which agent was used
- Which model (if detectable from output)
- Session duration
- Per-user and per-project breakdown

**What we DON'T track:**
- Actual commands/prompts sent to agent
- Agent output content
- API request details

**Analytics queries:**

```sql
-- Most popular agents (last 30 days)
select agent, count(*) as sessions
from agent_usage
where started_at > now() - interval '30 days'
group by agent
order by sessions desc;

-- Most popular models
select model, count(*) as sessions
from agent_usage
where model is not null
  and started_at > now() - interval '30 days'
group by model
order by sessions desc;

-- Average session duration by agent
select agent, avg(extract(epoch from (ended_at - started_at))) as avg_seconds
from agent_usage
where ended_at is not null
group by agent;
```

**API endpoint (for internal dashboard/analytics):**

```
GET /admin/analytics/agents?period=30d

Response 200:
{
  "period": "30d",
  "total_sessions": 1542,
  "by_agent": [
    {"agent": "claude", "sessions": 892, "percentage": 57.8},
    {"agent": "codex", "sessions": 412, "percentage": 26.7},
    {"agent": "aider", "sessions": 238, "percentage": 15.4}
  ],
  "by_model": [
    {"model": "claude-sonnet-4-20250514", "sessions": 654},
    {"model": "claude-opus-4-20250514", "sessions": 238},
    {"model": "gpt-4", "sessions": 312}
  ]
}
```

**Acceptance criteria:**
- Agent sessions are logged to database
- Can query most popular agents
- Can query most popular models (when detectable)
- Tracking is lightweight (doesn't impact terminal performance)
- No sensitive content is logged

---

### 5. Connected Accounts UI

Settings page for users to manage their API keys.

**Location:** User Settings → Connected Accounts

**UI mockup:**

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Profile | Connected Accounts | Billing                      │
│           ───────────────────                                │
│                                                              │
│  Connected Accounts                                          │
│  ─────────────────                                           │
│  Connect your AI provider accounts to use coding agents      │
│  in your projects.                                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ☐ Anthropic (Claude)                                  │  │
│  │                                                        │  │
│  │  API Key: [••••••••••••••••••••••]  [Connect]          │  │
│  │                                                        │  │
│  │  Get your API key from console.anthropic.com           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ✓ OpenAI (Codex)                     [Disconnect]     │  │
│  │                                                        │  │
│  │  Connected on Jan 10, 2024                             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ℹ️  Your API keys are encrypted and only used to      │  │
│  │     run agents in your cloud environments. We never    │  │
│  │     access your keys for any other purpose.            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**After connecting, in workspace:**

```
┌──────────────────────────────────────────────────────────────┐
│  WORKSPACE: my-project                        [Run Agent ▼]  │
├────────────┬─────────────────────────────────────────────────┤
│            │  TERMINAL                                       │
│  FILES     │  $ claude                                       │
│            │  ╭─────────────────────────────────────────────╮│
│            │  │ Claude Code v1.0.0                          ││
│            │  │ Ready to help with your project.            ││
│            │  │                                             ││
│            │  │ > What would you like to do?                ││
│            │  ╰─────────────────────────────────────────────╯│
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

**"Run Agent" dropdown (optional nice-to-have):**
- Quick actions: "Start Claude Code", "Start Codex"
- Opens new terminal tab with agent running
- Shows "Connect API key" if not configured

**Acceptance criteria:**
- User can add API keys from settings
- Clear indication of which providers are connected
- Can disconnect (remove) API keys
- Privacy notice explaining how keys are used
- Works across all user's projects without per-project setup

---

### 6. First-Run Experience

Help users who haven't connected their API keys yet.

**When user runs `claude` without API key configured:**

The agent will show its standard "API key not found" error. We can enhance this with:

**Option A: Documentation**
- Link in workspace to "How to use coding agents"
- Points to Settings → Connected Accounts

**Option B: Smart detection (nice-to-have)**
- Detect common agent commands in terminal output
- Show inline hint: "Tip: Connect your Anthropic API key in Settings to use Claude Code"

**Acceptance criteria:**
- User has clear path from "agent doesn't work" to "agent works"
- Documentation exists for setting up each supported agent

---

## File Structure Updates

```
aether/
├── apps/
│   ├── backend/
│   │   ├── internal/
│   │   │   ├── handlers/
│   │   │   │   ├── apikeys.go           # NEW: API key CRUD
│   │   │   │   └── analytics.go         # NEW: usage analytics endpoint
│   │   │   ├── services/
│   │   │   │   ├── crypto/
│   │   │   │   │   └── encryption.go    # NEW: AES-256-GCM helpers
│   │   │   │   ├── analytics/
│   │   │   │   │   └── agents.go        # NEW: agent usage tracking
│   │   │   │   └── fly/
│   │   │   │       └── machines.go      # UPDATED: inject env vars
│   │   │   └── ...
│   │   └── ...
│   │
│   └── web/
│       └── src/
│           ├── pages/
│           │   └── Settings.tsx         # UPDATED: add Connected Accounts tab
│           ├── components/
│           │   └── settings/
│           │       └── ConnectedAccounts.tsx  # NEW
│           └── ...
│
├── infra/
│   └── images/
│       └── base/
│           ├── Dockerfile               # UPDATED: add agents
│           └── tmux.conf                # NEW
│
├── supabase/
│   └── migrations/
│       └── 20240201000000_agent_usage.sql  # NEW
│
└── docs/
    └── guides/
        └── using-agents.md              # NEW
```

---

## Dependencies

**Backend (new):**
- Go standard library `crypto/aes` + `crypto/cipher` for encryption
- No external dependencies needed

**Frontend (new):**
- No new dependencies

**Base image (new):**
- `@anthropic-ai/claude-code` npm package
- System packages: tmux, ripgrep, fd-find, bat, jq, htop, tree

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Users uncomfortable storing API keys | Medium | High | Clear privacy notice, encryption at rest, transparent about usage |
| API key exposure in logs | Low | Critical | Never log decrypted keys, sanitize all output |
| Agent CLI versions become outdated | Medium | Low | Document how to update, periodic image rebuilds |
| Users exceed their API limits | Medium | Low | Not our problem — users manage their own API accounts |
| Encryption key compromise | Low | Critical | Use proper key derivation, rotate master key capability |
| Usage tracking misses some sessions | Medium | Low | Best effort tracking, patterns may not catch everything |

---

## Out of Scope for Phase 4

- External SSH access for agents (revisit if users request)
- Per-project API key overrides (use project env vars if needed)
- User-facing usage dashboard (internal analytics only for now)
- Deep IDE integrations
- Collaborative agent sessions

---

## Task Breakdown

### Week 7: Backend + Infrastructure

| Task | Estimate |
|------|----------|
| Backend: Encryption helpers (AES-256-GCM) | 2 hours |
| Backend: API key CRUD endpoints | 3 hours |
| Backend: Inject API keys on VM start | 3 hours |
| Database: Add api_keys_encrypted column + migration | 1 hour |
| Database: agent_usage table + migration | 1 hour |
| Update base image (agents + tools) | 3 hours |
| Test agent works end-to-end | 2 hours |

### Week 8: Frontend + Analytics + Polish

| Task | Estimate |
|------|----------|
| Frontend: Connected Accounts settings page | 4 hours |
| Frontend: API key input/management UI | 3 hours |
| Backend: Agent usage tracking in terminal proxy | 3 hours |
| Backend: Analytics endpoint | 2 hours |
| Frontend: "Run Agent" button (optional) | 2 hours |
| Documentation: Using agents guide | 2 hours |
| Integration testing | 2 hours |
| Bug fixes and polish | 3 hours |

**Total estimated hours:** ~36 hours

---

## Definition of Done

Phase 4 is complete when:

1. ✅ User can add API keys in Settings → Connected Accounts
2. ✅ API keys are encrypted at rest
3. ✅ API keys are injected into VMs on start
4. ✅ Claude Code is pre-installed on base image
5. ✅ User can run `claude` in terminal and it works
6. ✅ Works across all user's projects without per-project setup
7. ✅ Agent usage is tracked (agent, model, duration)
8. ✅ Can query analytics on popular agents/models
9. ✅ Documentation exists for getting started with agents
10. ✅ Privacy notice explains how keys are stored/used

---

## Design Decisions

1. **User-level keys (not per-project):** Users shouldn't have to configure API keys for every project. One-time setup, works everywhere.

2. **Pre-installed agents:** Zero friction. User opens terminal, runs agent. No installation steps.

3. **Encryption at rest:** API keys encrypted with AES-256-GCM. Even database breach doesn't expose usable keys.

4. **Server-side decryption only:** Keys are decrypted only when injecting into VM. Never sent back to frontend after initial save.

5. **No SSH approach (for now):** Simpler architecture, faster to ship. Can add external agent SSH support later if users request it.

6. **Standard env vars:** Use `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — the standard names agents expect. No custom configuration needed.

7. **Lightweight usage tracking:** Pattern matching on terminal output. Best effort, doesn't need to be perfect. Enough for analytics on popular agents/models.

---

## API Reference

**List connected providers**
```
GET /user/api-keys

Response 200:
{
  "providers": [
    {"provider": "anthropic", "connected": true, "added_at": "2024-01-10T..."},
    {"provider": "openai", "connected": false}
  ]
}
```

**Add/update API key**
```
POST /user/api-keys
{
  "provider": "anthropic",
  "api_key": "sk-ant-..."
}

Response 200:
{
  "provider": "anthropic",
  "connected": true,
  "added_at": "2024-01-10T..."
}
```

**Remove API key**
```
DELETE /user/api-keys/anthropic

Response 204 (no content)
```

**Agent analytics (internal)**
```
GET /admin/analytics/agents?period=30d

Response 200:
{
  "period": "30d",
  "total_sessions": 1542,
  "by_agent": [
    {"agent": "claude", "sessions": 892, "percentage": 57.8},
    {"agent": "codex", "sessions": 412, "percentage": 26.7}
  ],
  "by_model": [
    {"model": "claude-sonnet-4-20250514", "sessions": 654},
    {"model": "gpt-4", "sessions": 312}
  ]
}
```

---

## Future Considerations

**If users request external agent access** (agent running on their local machine connecting to aether):
- Could add SSH key-based auth
- Could expose project as remote development target
- Evaluate based on actual user demand

**User-facing analytics:**
- Show users their own agent usage stats
- "You've used Claude for 42 sessions this month"
- Could tie into Phase 5 dashboard

For now, the pre-installed agent approach covers the primary use case with dramatically less complexity than the original SSH-based design.
