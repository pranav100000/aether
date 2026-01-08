# Phase 4 PRD: Agent Integration

**Project:** aether (working title)
**Phase:** 4 of 5
**Timeline:** Weeks 7-8
**Goal:** Enable external coding agents (Claude Code, Codex, etc.) to connect to and work in user projects

---

## Overview

This is the differentiator. Phase 4 makes aether agent-agnostic — users can connect whatever coding agent they prefer to their cloud environment. By the end of this phase:

1. Users can generate SSH credentials for their project
2. Claude Code (or any SSH-capable agent) can connect
3. Users can watch agent activity in real-time in the browser
4. Multiple agents can connect to the same project

This transforms aether from "Replit clone" to "the cloud environment for AI-assisted coding."

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Agent connection time | <5 seconds from command to shell |
| Agent command latency | <100ms (same as user terminal) |
| Activity feed latency | <500ms from agent action to browser |
| Concurrent agents | Support at least 3 per project |
| Connection reliability | Stable for 1+ hour sessions |

---

## Technical Requirements

### 1. Agent Authentication

Allow users to create SSH credentials that agents use to connect.

**Approach:** Per-project SSH keys (not passwords)

**Database schema update:**

```sql
create table agent_tokens (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    
    -- SSH key (we generate the keypair)
    public_key text not null,
    private_key_encrypted text not null,  -- encrypted at rest
    
    -- Metadata
    name text not null,                    -- "Claude Code", "My Laptop", etc.
    last_used_at timestamptz,
    created_at timestamptz default now(),
    expires_at timestamptz                 -- optional expiry
);

create index agent_tokens_project_id_idx on agent_tokens(project_id);
```

**Key management:**
- Backend generates Ed25519 keypair
- Public key added to VM's `~/.ssh/authorized_keys`
- Private key encrypted with project-specific secret, stored in DB
- Private key shown to user ONCE at creation (they copy it)
- User can revoke tokens (removes from `authorized_keys`)

**API endpoints:**

```
GET    /projects/:id/agents           List agent tokens (no private keys)
POST   /projects/:id/agents           Create new agent token
DELETE /projects/:id/agents/:tokenId  Revoke agent token
```

**Create response (only time private key is shown):**
```json
{
  "id": "uuid",
  "name": "Claude Code",
  "public_key": "ssh-ed25519 AAAA...",
  "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "connection_string": "ssh coder@{machine}.fly.dev -i ~/.ssh/aether_claude",
  "created_at": "..."
}
```

**Acceptance criteria:**
- Can create agent token, receive private key
- Private key only shown once
- Can list tokens (without private keys)
- Can revoke tokens
- Revoked tokens can't connect
- Keys are encrypted at rest in database

---

### 2. SSH Gateway

Route agent SSH connections to the correct project VM.

**Option A: Direct to Fly Machine**

Each Fly Machine has a public IP. Agents SSH directly:

```bash
ssh coder@{fly-machine-id}.fly.dev -i ~/.ssh/aether_key
```

**Pros:** Simple, no extra infrastructure
**Cons:** Machine must be running, IP changes on restart

**Option B: SSH Gateway/Bastion (Recommended for future)**

Run a gateway service that:
1. Accepts SSH connections on `ssh.aether.dev`
2. Authenticates using agent token
3. Starts project VM if stopped
4. Proxies connection to VM

```bash
ssh {project-id}@ssh.aether.dev -i ~/.ssh/aether_key
```

**Recommendation:** Start with Option A for simplicity, plan for Option B.

**Phase 4 implementation (Option A):**
- Expose SSH port (22) on Fly Machines
- Add user's public keys to `authorized_keys` on VM start
- Provide connection string with Fly Machine hostname
- Document that VM must be running (or user starts it first)

**Connection flow:**
```
Agent (Claude Code)
    ↓ SSH
Fly Machine ({machine-id}.fly.dev:22)
    ↓ 
Shell as 'coder' user
```

**authorized_keys management:**
- On VM start, backend writes all active agent public keys to `~/.ssh/authorized_keys`
- On token revoke, backend removes key (requires VM to be running, or queued for next start)
- Each key gets a comment with token ID for tracking

```
# ~/.ssh/authorized_keys
ssh-ed25519 AAAA... aether-agent-{token-id-1}
ssh-ed25519 AAAA... aether-agent-{token-id-2}
ssh-ed25519 AAAA... aether-backend
```

**Acceptance criteria:**
- Agent can SSH to running VM with valid key
- Invalid keys are rejected
- Revoked keys stop working (after next VM start if currently stopped)
- Multiple agents can connect simultaneously

---

### 3. Agent Activity Feed

Show users what agents are doing in real-time.

**Approach:** Shared tmux session with read-only view.

**How it works:**

1. All agent SSH sessions attach to a shared tmux session named `agent`
2. Browser connects to a WebSocket that streams tmux pane output
3. User sees real-time agent activity (read-only)

**VM-side setup:**

When an agent connects via SSH, force them into tmux:

```bash
# /etc/ssh/sshd_config
Match User coder
    ForceCommand /usr/local/bin/agent-shell.sh
```

```bash
#!/bin/bash
# /usr/local/bin/agent-shell.sh
# Determine if this is the backend (for user terminal) or an agent

if [ "$SSH_ORIGINAL_COMMAND" = "__aether_user_terminal__" ]; then
    # User terminal - regular shell
    exec bash -l
else
    # Agent connection - use tmux
    SESSION="agent"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        exec tmux attach -t "$SESSION"
    else
        exec tmux new-session -s "$SESSION"
    fi
fi
```

**Simpler v1 approach:**

Skip ForceCommand complexity. Just provide optional tmux-based viewing:

1. Document that agents can use tmux manually
2. Add a "Watch Agent" button that opens a read-only terminal attached to `tmux attach -t agent`
3. If no tmux session exists, show "No agent activity"

**Backend endpoint:**

```
GET /projects/:id/agent-terminal
Upgrade: websocket
```

This opens a read-only SSH session that runs:
```bash
tmux attach -t agent -r  # -r = read-only
```

**UI in workspace:**

```
┌─────────────────────────────────────────────────────────────────┐
│  WORKSPACE                                                      │
├────────────┬────────────────────────────────────────────────────┤
│            │  EDITOR                                            │
│  FILES     │                                                    │
│            ├────────────────────────────────────────────────────┤
│            │  TERMINALS                    [+] [User ▼] [Agent] │
│            │  ┌────────────────────────────────────────────────┐│
│            │  │ $ vim src/index.js                             ││
│            │  │ (agent editing file...)                        ││
│            │  │                                                ││
│            │  └────────────────────────────────────────────────┘│
└────────────┴────────────────────────────────────────────────────┘
```

**Terminal tabs:**
- "User" — Interactive terminal (existing)
- "Agent" — Read-only view of agent tmux session

**Acceptance criteria:**
- User can see agent terminal activity in browser
- Activity updates in near-real-time
- View is read-only (user can't type)
- Graceful handling when no agent session exists

---

### 4. Agent Connection UX

Make it dead simple for users to connect their agents.

**"Connect Agent" button in workspace header:**

Opens modal with:

1. **Create new connection**
   - Name input ("Claude Code", "Codex", etc.)
   - Create button

2. **Credentials display (after creation)**
   - Private key (copy button)
   - Connection command (copy button)
   - "I've saved this" confirmation

3. **Active connections list**
   - Name, created date, last used
   - Revoke button per connection

4. **Setup guides**
   - Tabs for: Claude Code, Codex, Generic SSH
   - Copy-paste instructions

**Modal UI:**

```
┌──────────────────────────────────────────────────────────────┐
│  Connect an Agent                                        [×] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ▼ Claude Code  │ Codex  │ Other                      │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  1. Create a connection:                                     │
│     Name: [Claude Code             ]  [Create Connection]    │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  2. Save this private key (shown once):                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ -----BEGIN OPENSSH PRIVATE KEY-----                    │  │
│  │ b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAA...                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                    [Copy]    │
│                                                              │
│  3. Save key and connect:                                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ # Save the key                                         │  │
│  │ cat > ~/.ssh/aether_key << 'EOF'                        │  │
│  │ <paste key here>                                       │  │
│  │ EOF                                                    │  │
│  │ chmod 600 ~/.ssh/aether_key                             │  │
│  │                                                        │  │
│  │ # Connect with Claude Code                             │  │
│  │ claude-code --ssh coder@abc123.fly.dev \               │  │
│  │   --identity ~/.ssh/aether_key                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                    [Copy]    │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  Active Connections:                                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Claude Code     2 hours ago           [Revoke]         │  │
│  │ My Laptop       5 days ago            [Revoke]         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Acceptance criteria:**
- Clear, step-by-step flow
- Private key copyable with one click
- Setup commands copyable with one click
- Can manage (view/revoke) existing connections
- Guides for at least Claude Code and generic SSH

---

### 5. Base Image Updates

Update VM image to support agent workflows.

**Additional packages:**

```dockerfile
# Useful for agents
RUN apt-get install -y \
    tmux \
    ripgrep \
    fd-find \
    bat \
    jq \
    htop \
    tree

# Configure tmux
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
```

**Acceptance criteria:**
- Base image has tmux, ripgrep, fd-find, bat, jq
- tmux configured with reasonable defaults
- Image still boots in <3 seconds

---

## File Structure Updates

```
aether/
├── backend/
│   ├── handlers/
│   │   ├── agents.go              # NEW: agent token CRUD
│   │   ├── agent_terminal.go      # NEW: agent activity stream
│   │   └── ...
│   ├── crypto/
│   │   └── keys.go                # NEW: SSH key generation
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AgentModal.tsx     # NEW
│   │   │   ├── AgentList.tsx      # NEW
│   │   │   ├── AgentTerminal.tsx  # NEW
│   │   │   ├── AgentGuides.tsx    # NEW
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   └── useAgents.ts       # NEW
│   │   └── ...
│   └── ...
├── infra/
│   └── images/
│       └── base/
│           ├── Dockerfile         # Updated
│           └── tmux.conf          # NEW
└── docs/
    └── agents/
        ├── claude-code.md         # NEW
        ├── codex.md               # NEW
        └── generic-ssh.md         # NEW
```

---

## Dependencies

**Backend (new):**
- `golang.org/x/crypto/ssh` — Already have, use for key generation
- Key encryption: use Go's `crypto/aes` + `crypto/cipher` with a secret from environment

**Frontend (new):**
- No new dependencies

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SSH key security | Medium | High | Encrypt at rest, show once, educate users |
| Users lose private key | High | Medium | Clear warning, no recovery (security feature) |
| Agent sessions conflict | Medium | Low | Separate tmux sessions, document behavior |
| Tmux complexity | Medium | Medium | Keep it optional, simple defaults |
| Machine must be running | Medium | Low | Clear UI state, future: wake-on-connect |

---

## Out of Scope for Phase 4

- SSH gateway with wake-on-connect — Future
- Per-agent usage tracking — Phase 5
- Agent permissions/sandboxing — Future  
- Deep integrations (Claude Code plugin) — Future
- Collaborative editing — Future

---

## Task Breakdown

### Week 7

| Task | Estimate | Owner |
|------|----------|-------|
| Backend: SSH key generation (Ed25519) | 3 hours | — |
| Backend: Key encryption/decryption helpers | 3 hours | — |
| Backend: Agent token CRUD endpoints | 4 hours | — |
| Database: agent_tokens table + RLS policies | 2 hours | — |
| Backend: authorized_keys sync on VM start | 4 hours | — |
| Update base image (tmux, ripgrep, etc.) | 3 hours | — |
| End-to-end SSH connection test | 3 hours | — |

### Week 8

| Task | Estimate | Owner |
|------|----------|-------|
| Frontend: Agent modal UI | 5 hours | — |
| Frontend: Create connection flow | 3 hours | — |
| Frontend: Connection list + revoke | 2 hours | — |
| Frontend: Setup guides (Claude Code, generic) | 3 hours | — |
| Backend: Agent terminal WebSocket endpoint | 4 hours | — |
| Frontend: Agent terminal view (read-only) | 4 hours | — |
| Integration test with Claude Code | 4 hours | — |
| Documentation | 3 hours | — |
| Bug fixes and polish | 4 hours | — |

**Total estimated hours:** ~54 hours

---

## Definition of Done

Phase 4 is complete when:

1. ✅ User can create agent SSH credentials from UI
2. ✅ Private key shown once, copyable
3. ✅ Clear setup instructions displayed
4. ✅ Claude Code can SSH in and run commands
5. ✅ User can list active agent connections
6. ✅ User can revoke connections
7. ✅ Revoked keys no longer work
8. ✅ User can view agent activity (tmux-based)
9. ✅ Documentation for Claude Code setup exists

---

## Design Decisions

1. **Key generation:** Backend generates Ed25519 keys. More secure than user-provided keys, consistent format, no browser crypto complexity.

2. **Show key once:** Private key displayed only at creation. Cannot be retrieved later. This is intentional — matches security best practices (GitHub, AWS, etc.).

3. **Direct SSH for v1:** Agents connect directly to Fly Machine. No gateway. Simple, works, revisit when we need wake-on-connect.

4. **Tmux for monitoring:** Optional shared tmux session. Agents can use it if they want session persistence. Users can watch if they want. Not forced.

5. **No ForceCommand:** Keep SSH simple for v1. Don't force agents into tmux — let them decide. We just provide the infrastructure.

6. **Encryption:** Private keys encrypted with AES-256-GCM using a per-project secret derived from a master key + project ID. Even DB breach doesn't expose usable keys.

---

## API Reference

**List agent tokens**
```
GET /projects/:id/agents

Response 200:
{
  "agents": [
    {
      "id": "uuid",
      "name": "Claude Code",
      "public_key": "ssh-ed25519 AAAA...",
      "last_used_at": "2024-01-15T...",
      "created_at": "2024-01-10T..."
    }
  ]
}
```

**Create agent token**
```
POST /projects/:id/agents
{
  "name": "Claude Code"
}

Response 201:
{
  "id": "uuid",
  "name": "Claude Code",
  "public_key": "ssh-ed25519 AAAA...",
  "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "host": "abc123.fly.dev",
  "user": "coder",
  "port": 22,
  "created_at": "..."
}
```

**Revoke agent token**
```
DELETE /projects/:id/agents/:tokenId

Response 204 (no content)
```

**Agent activity terminal**
```
GET /projects/:id/agent-terminal
Upgrade: websocket

(Same protocol as user terminal, but read-only - input ignored)
```
