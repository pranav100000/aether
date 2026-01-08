# Phase 1 PRD: Core Infrastructure

**Project:** aether (working title)
**Phase:** 1 of 5
**Timeline:** Weeks 1-2
**Goal:** Prove the core works — get a VM running and connect to it from a browser

---

## Overview

Phase 1 is about de-risking the hardest technical problem: can we spin up cloud VMs on demand and give users a responsive terminal experience in the browser? Nothing else matters until this works well.

By the end of Phase 1, we should be able to:
1. Create a Fly Machine programmatically with a base image
2. Start/stop machines via our Go backend
3. Connect from a browser terminal (xterm.js) to a shell in the VM
4. Type commands with acceptably low latency (<100ms round trip)

This phase is intentionally minimal. No auth, no database, no UI polish. Just the core loop working.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| VM cold start time | <3 seconds |
| Terminal input latency | <100ms perceived |
| Connection reliability | No dropped connections during 30-min session |
| Machine lifecycle | Can create, start, stop, destroy programmatically |

---

## Technical Requirements

### 1. Base Image

Create a Docker image that will serve as the foundation for user environments.

**Image contents:**
- Ubuntu 22.04 LTS base
- Node.js 20 LTS + npm + pnpm
- Python 3.11 + pip
- Go 1.21
- Git, curl, wget, build-essential
- OpenSSH server (for agent connections later)
- A non-root user (`coder`) with sudo access

**Dockerfile location:** `/infra/images/base/Dockerfile`

**Acceptance criteria:**
- Image builds successfully
- Image size <2GB
- Can run `node`, `python3`, `go` commands
- SSH server starts on boot

---

### 2. Fly Machine Orchestration

Build a Go service that manages Fly Machine lifecycle.

**Endpoints:**

```
POST   /machines          Create a new machine
GET    /machines/:id      Get machine status
POST   /machines/:id/start   Start a stopped machine
POST   /machines/:id/stop    Stop a running machine
DELETE /machines/:id      Destroy a machine
```

**Machine states:**
```
created → starting → running → stopping → stopped
                         ↓
                       error
```

**Implementation details:**
- Use Fly Machines API (not fly.io apps)
- Store machine state in memory for now (no database yet)
- Each machine gets a unique ID (UUID)
- Track last activity timestamp per machine
- Background goroutine checks every minute, stops machines idle >10 minutes

**Environment variables needed:**
- `FLY_API_TOKEN` — Fly.io API token
- `FLY_APP_NAME` — Fly app to create machines in
- `FLY_REGION` — Default region (e.g., `sjc`)

**Acceptance criteria:**
- Can create a machine and it appears in Fly dashboard
- Can start/stop machine programmatically
- Can destroy machine and it's removed from Fly
- Errors are handled gracefully (API failures, timeouts)

---

### 3. Terminal Proxy

Bridge WebSocket connections from the browser to a shell session in the VM.

**Architecture:**
```
Browser (xterm.js)
    ↓ WebSocket
Go Backend (/machines/:id/terminal)
    ↓ SSH
Fly Machine (bash shell)
```

**Implementation details:**
- WebSocket endpoint: `GET /machines/:id/terminal` (upgrades to WS)
- Backend SSHs into the machine using a pre-configured key
- Bidirectional stream: stdin from browser → SSH, stdout from SSH → browser
- Handle terminal resize (SIGWINCH) via WebSocket control messages
- Graceful disconnection handling

**SSH setup:**
- Generate an SSH keypair for the backend
- Public key baked into base image (`/home/coder/.ssh/authorized_keys`)
- Private key stored as environment variable or secret

**Message format (WebSocket):**
```json
// Input (browser → backend)
{"type": "input", "data": "ls -la\n"}
{"type": "resize", "cols": 120, "rows": 40}

// Output (backend → browser)
{"type": "output", "data": "total 48\ndrwxr-xr-x..."}
{"type": "error", "message": "Connection lost"}
{"type": "reconnected", "message": "New session started"}
```

**Reconnection behavior:**
- On WebSocket disconnect, frontend attempts reconnect with exponential backoff
- Reconnection creates a new shell session (no session persistence in Phase 1)
- Display clear message to user: "Connection lost. Reconnected — new session."

**Acceptance criteria:**
- Can open WebSocket connection to running machine
- Keystrokes appear in VM shell
- Command output streams back to browser
- Terminal resize works
- Connection survives brief network interruptions
- Clean disconnect when machine stops

---

### 4. Browser Terminal Client

Minimal web page with xterm.js connected to the backend.

**Tech:**
- Single HTML file (no build step needed for Phase 1)
- xterm.js + xterm-addon-fit + xterm-addon-webgl
- WebSocket connection to backend

**Features:**
- Full terminal emulation (colors, cursor, scrollback)
- Auto-resize to fit container
- Reconnection on disconnect
- Visual indicator of connection status

**UI (minimal):**
```
┌─────────────────────────────────────────────┐
│ Machine: abc123  Status: ● Connected        │
├─────────────────────────────────────────────┤
│                                             │
│  coder@aether:~$ ls                          │
│  projects  documents                        │
│  coder@aether:~$ █                           │
│                                             │
│                                             │
└─────────────────────────────────────────────┘
```

**Acceptance criteria:**
- Terminal renders correctly (no visual glitches)
- Can run interactive programs (vim, htop, node REPL)
- Copy/paste works
- Feels responsive (no perceptible lag on typing)

---

## File Structure

```
aether/
├── backend/
│   ├── main.go
│   ├── go.mod
│   ├── handlers/
│   │   ├── machines.go      # CRUD endpoints
│   │   └── terminal.go      # WebSocket proxy
│   ├── fly/
│   │   └── client.go        # Fly API wrapper
│   └── ssh/
│       └── client.go        # SSH connection manager
├── frontend/
│   └── terminal.html        # Standalone terminal page
├── infra/
│   └── images/
│       └── base/
│           └── Dockerfile
├── scripts/
│   ├── build-image.sh
│   └── deploy.sh
└── README.md
```

---

## Dependencies

**Go packages:**
- `github.com/go-chi/chi/v5` — HTTP router
- `github.com/gorilla/websocket` — WebSocket handling
- `golang.org/x/crypto/ssh` — SSH client

**Frontend (CDN):**
- xterm.js 5.x
- xterm-addon-fit
- xterm-addon-webgl

**Infrastructure:**
- Fly.io account with Machines API access
- Docker for building images

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fly Machines API is slow/unreliable | Low | High | Have fallback plan to use Fly Apps or raw Firecracker |
| SSH latency is too high | Medium | High | Test early, consider direct PTY if needed |
| WebSocket connections drop frequently | Medium | Medium | Implement reconnection logic, heartbeats |
| Base image too large, slow boot | Medium | Medium | Multi-stage builds, layer optimization |

---

## Out of Scope for Phase 1

These are explicitly NOT part of Phase 1:

- User authentication
- Database / persistence
- Multiple base images / language selection
- File editing (CodeMirror)
- Port forwarding / preview URLs
- Agent connections (SSH gateway)
- Billing / usage tracking
- Any UI beyond the basic terminal page

---

## Task Breakdown

### Week 1

| Task | Estimate | Owner |
|------|----------|-------|
| Set up Fly.io app and API access | 2 hours | — |
| Create base Dockerfile | 4 hours | — |
| Build and push image to Fly registry | 2 hours | — |
| Go project setup (chi, websocket, ssh) | 2 hours | — |
| Implement Fly API client (create, start, stop, destroy) | 8 hours | — |
| Implement machine CRUD endpoints | 4 hours | — |
| Implement idle timeout checker (10 min) | 2 hours | — |
| Manual testing of machine lifecycle | 2 hours | — |

### Week 2

| Task | Estimate | Owner |
|------|----------|-------|
| SSH key generation and setup | 2 hours | — |
| Implement SSH client wrapper | 6 hours | — |
| Implement WebSocket terminal proxy | 8 hours | — |
| Build terminal.html with xterm.js | 4 hours | — |
| Connect frontend to backend | 4 hours | — |
| Latency testing and optimization | 4 hours | — |
| End-to-end testing and bug fixes | 4 hours | — |
| Documentation and README | 2 hours | — |

**Total estimated hours:** ~54 hours

---

## Definition of Done

Phase 1 is complete when:

1. ✅ A developer can run the Go backend locally
2. ✅ Hitting `POST /machines` creates a Fly Machine
3. ✅ Opening `terminal.html?machine=<id>` connects to that machine
4. ✅ Commands typed in the browser execute in the VM
5. ✅ Output streams back in real-time
6. ✅ Stopping the machine closes the terminal gracefully
7. ✅ The experience feels responsive (subjectively "good enough")

---

## Design Decisions

1. **SSH vs direct PTY:** Use SSH for Phase 1. It's battle-tested, requires no custom agent in the VM, and works with any base image. The ~20-30ms latency overhead is acceptable. If latency becomes a problem at scale, we can add a lightweight PTY agent later.

2. **Machine networking:** Public IP + SSH with key auth. Private networking adds complexity we don't need with <100 users. Revisit with Fly private networking or Tailscale when we hit scale.

3. **Reconnection strategy:** Start fresh on reconnect. Resuming sessions would require tmux/screen in every VM plus session tracking — too much complexity for Phase 1. Show a clear message: "Connection lost. Reconnected — new session." Add session persistence in a later phase if users request it.

4. **Idle timeout:** Implement in Phase 1. Track last WebSocket activity per machine, check every minute, stop machines after 10 minutes idle. This prevents surprise bills from forgotten machines. Stop only (don't destroy) so users can restart easily.

---

## Appendix: Fly Machines API Reference

**Create machine:**
```bash
curl -X POST "https://api.machines.dev/v1/apps/{app}/machines" \
  -H "Authorization: Bearer ${FLY_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "image": "registry.fly.io/{app}/base:latest",
      "guest": {"cpu_kind": "shared", "cpus": 1, "memory_mb": 512}
    }
  }'
```

**Start machine:**
```bash
curl -X POST "https://api.machines.dev/v1/apps/{app}/machines/{id}/start" \
  -H "Authorization: Bearer ${FLY_API_TOKEN}"
```

**Stop machine:**
```bash
curl -X POST "https://api.machines.dev/v1/apps/{app}/machines/{id}/stop" \
  -H "Authorization: Bearer ${FLY_API_TOKEN}"
```

**Delete machine:**
```bash
curl -X DELETE "https://api.machines.dev/v1/apps/{app}/machines/{id}" \
  -H "Authorization: Bearer ${FLY_API_TOKEN}"
```
