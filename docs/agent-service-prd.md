# Agent Service PRD

## Overview

A Bun CLI for running AI coding agents (Claude Code, Codex, OpenCode) inside project VMs. Provides structured JSON messages via stdin/stdout, replacing fragile terminal output parsing. Accessed through the Go backend via SSH, just like the terminal.

## Goals

1. **Multi-Agent** - Support Claude Code, Codex, and OpenCode from day one
2. **Reliability** - Structured JSON messages instead of parsing ANSI terminal output
3. **Simplicity** - Reuse existing SSH infrastructure, no new ports or services
4. **Performance** - Bun for fast startup and low overhead

## Non-Goals

- Running agents as a separate Fly app (runs inside project VM)
- Building our own agent framework (use official SDKs where available)
- Replacing the Go backend for terminal sessions (keep existing PTY for regular terminals)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌─────────────────┐              ┌─────────────────┐           │
│  │ TerminalWidget  │              │  AgentWidget    │           │
│  │ (regular shell) │              │  (AI agents)    │           │
│  └────────┬────────┘              └────────┬────────┘           │
│           │                                │                     │
└───────────┼────────────────────────────────┼─────────────────────┘
            │                                │
            │ WebSocket                      │ WebSocket
            │ /projects/:id/terminal         │ /projects/:id/agent/:agent
            │                                │
┌───────────┴────────────────────────────────┴─────────────────────┐
│                         Go Backend                                │
│  ┌─────────────────┐              ┌─────────────────┐            │
│  │ Terminal Handler│              │  Agent Handler  │            │
│  │ (SSH → shell)   │              │  (SSH → CLI)    │            │
│  └────────┬────────┘              └────────┬────────┘            │
└───────────┼────────────────────────────────┼─────────────────────┘
            │                                │
            │ SSH (port 2222)                │ SSH (port 2222)
            │                                │
┌───────────┴────────────────────────────────┴─────────────────────┐
│                      Project VM (Fly Machine)                     │
│  ┌─────────────────┐              ┌─────────────────┐            │
│  │  Shell (bash)   │              │   Agent CLI     │            │
│  │  via PTY        │              │   via stdio     │            │
│  └─────────────────┘              └─────────────────┘            │
│                                                                   │
│  Working directory: /home/coder/project                          │
└───────────────────────────────────────────────────────────────────┘
```

**Key insight**: Agent access works exactly like terminal access - Go backend SSHs into the VM and runs a command. For terminal, it opens a shell with PTY. For agents, it runs the agent CLI and proxies stdin/stdout.

---

## Supported Agents

### Claude Code

**Integration**: Claude CLI with streaming JSON output

```bash
claude --print --output-format stream-json --verbose --include-partial-messages "<prompt>"
```

The CLI outputs newline-delimited JSON messages that we parse and forward to the frontend. Conversation history is managed by our service (not Claude's session management) by prepending previous messages to each prompt.

**Built-in Tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, TodoWrite

**Permission Modes**: `default`, `acceptEdits`, `plan`, `bypassPermissions`

### Codex (OpenAI)

**Integration**: Codex CLI with streaming JSON output

```bash
codex --json --non-interactive "<prompt>"
```

Similar CLI-based approach to Claude. The Codex CLI handles tool execution internally.

**Built-in Tools**: Code execution, File operations, Shell commands

### OpenCode

**Integration**: CLI wrapper (TBD based on their CLI availability)

---

## Communication Protocol

### Stdio-based (Agent CLI ↔ Go Backend)

The agent CLI reads JSON from stdin and writes JSON to stdout:

```
Go Backend                    Agent CLI
    │                             │
    │  {"type":"prompt",...}      │
    │ ─────────────────────────→  │
    │                             │
    │  {"type":"text",...}        │
    │ ←─────────────────────────  │
    │  {"type":"tool_use",...}    │
    │ ←─────────────────────────  │
    │                             │
    │  {"type":"approve",...}     │
    │ ─────────────────────────→  │
    │                             │
    │  {"type":"done",...}        │
    │ ←─────────────────────────  │
```

### Client → Agent Messages (stdin)

```typescript
interface ClientMessage {
  type: 'prompt' | 'approve' | 'reject' | 'abort' | 'settings'

  // For 'prompt'
  prompt?: string
  settings?: AgentSettings     // Optional inline settings with prompt

  // For 'approve' / 'reject'
  toolId?: string

  // For 'settings' - runtime settings
  settings?: AgentSettings
}

interface AgentSettings {
  model?: string                          // Model override (e.g., 'sonnet', 'opus')
  permissionMode?: PermissionMode         // default | acceptEdits | plan | bypassPermissions
  extendedThinking?: boolean              // Enable extended thinking mode
}
```

### Agent → Client Messages (stdout)

```typescript
interface AgentMessage {
  type: 'init' | 'history' | 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done'

  // Which agent is responding
  agent: 'claude' | 'codex' | 'opencode'

  // Session info (type: 'init')
  sessionId?: string

  // Previous messages (type: 'history') - sent on reconnect
  history?: StoredMessage[]

  // Text content (type: 'text' | 'thinking')
  content?: string
  streaming?: boolean

  // Tool usage (type: 'tool_use')
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: 'pending' | 'running' | 'complete'
  }

  // Tool result (type: 'tool_result')
  toolId?: string
  result?: string
  error?: string

  // Error (type: 'error')
  error?: string

  // Usage stats (type: 'done')
  usage?: {
    inputTokens: number
    outputTokens: number
    cost: number
  }
}

interface StoredMessage {
  id: string
  timestamp: number
  role: 'user' | 'assistant' | 'system'
  content: string
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: string
    result?: string
    error?: string
  }
}
```

---

## Agent Abstraction

Unified interface for all agents:

```typescript
// src/types.ts
export type AgentType = 'claude' | 'codex' | 'opencode'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface AgentConfig {
  cwd: string
  autoApprove: boolean
  model?: string
  permissionMode?: PermissionMode
  extendedThinking?: boolean
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface AgentProvider {
  readonly name: AgentType

  // Check if provider is configured (has API key)
  isConfigured(): boolean

  // Send a prompt and stream responses
  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>

  // Handle tool approval (optional - not all agents support it)
  approveToolUse?(toolId: string): void
  rejectToolUse?(toolId: string): void

  // Abort current operation
  abort(): void
}
```

**Conversation History**: Each provider receives the full conversation history and is responsible for providing context to the underlying agent. For CLI-based agents (Claude, Codex), this is done by prepending the history to the prompt.

---

## File Structure

```
agent-service/
├── src/
│   ├── cli.ts                # Main CLI entry point (stdin/stdout)
│   ├── types.ts              # Shared types (AgentConfig, AgentMessage, etc.)
│   ├── storage.ts            # Session persistence (filesystem-based)
│   │
│   └── agents/
│       ├── index.ts          # Provider registry + getProvider()
│       ├── claude.ts         # Claude CLI integration
│       ├── codex.ts          # Codex CLI integration
│       └── opencode.ts       # OpenCode integration
│
├── package.json
└── tsconfig.json
```

### Session Storage

Sessions are persisted to the filesystem at `{STORAGE_DIR}/{agent}/`:

```
/home/coder/project/.aether/
├── claude/
│   ├── current              # Current session ID
│   └── {sessionId}.json     # Session history
├── codex/
│   └── ...
└── opencode/
    └── ...
```

Environment variables:
- `STORAGE_DIR`: Base directory for session storage (default: `/home/coder/project/.aether`)
- `PROJECT_CWD`: Working directory for agent operations (default: `/home/coder/project`)

---

## Deployment

### Inside Project VM

The agent CLI is bundled into the project VM image:

```
/opt/agent-service/
├── src/
│   ├── cli.ts
│   ├── types.ts
│   └── agents/
├── package.json
└── node_modules/
```

### VM Startup

The agent is NOT a long-running service. It's invoked on-demand when a user connects:

```bash
# Go backend runs this via SSH when user opens agent widget
bun /opt/agent-service/src/cli.ts claude
```

### Environment Variables

Set in the VM environment:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # For Claude
OPENAI_API_KEY=sk-...          # For Codex
OPENCODE_API_KEY=...           # For OpenCode
```

---

## Go Backend Changes

### New Handler: agent.go

```go
// handlers/agent.go
func (h *Handler) HandleAgent(w http.ResponseWriter, r *http.Request) {
    projectID := chi.URLParam(r, "id")
    agent := chi.URLParam(r, "agent")  // "claude", "codex", "opencode"

    // Auth + get project (same as terminal)
    project, err := h.db.GetProject(ctx, projectID)
    machine, err := h.fly.GetMachine(project.FlyMachineID)

    // Upgrade WebSocket
    conn, err := upgrader.Upgrade(w, r, nil)

    // SSH to VM and run agent CLI
    sshSession, err := h.sshClient.Connect(machine.PrivateIP, 2222)
    sshSession.Run(fmt.Sprintf("bun /opt/agent-service/src/cli.ts %s", agent))

    // Proxy WebSocket ↔ SSH stdin/stdout
    go proxyWebSocketToStdin(conn, sshSession.Stdin)
    go proxyStdoutToWebSocket(sshSession.Stdout, conn)
}
```

### Route

```go
// main.go
r.Get("/projects/{id}/agent/{agent}", handler.HandleAgent)
```

---

## Frontend Changes

### New Hook: useAgentConnection

```typescript
interface UseAgentConnectionOptions {
  projectId: string
  agent: 'claude' | 'codex' | 'opencode'
  onMessage?: (msg: AgentMessage) => void
}

function useAgentConnection(options: UseAgentConnectionOptions) {
  // Connects to /projects/:id/agent/:agent via WebSocket
  return {
    isConnected: boolean
    sessionId: string | null

    // Actions
    sendPrompt: (text: string) => void
    approve: (toolId: string) => void
    reject: (toolId: string) => void
    abort: () => void
    configure: (config: { autoApprove?: boolean }) => void

    // State
    messages: AgentMessage[]
    isThinking: boolean
    pendingToolCalls: ToolUse[]
  }
}
```

---

## Implementation Phases

### [Phase 1: Claude MVP](./agent-service/phase-1-claude-mvp.md) ✅
Get Claude Code working end-to-end.
- Agent CLI with stdin/stdout JSON protocol
- ClaudeProvider using Claude CLI (`--print --output-format stream-json`)
- Session persistence with conversation history
- Go backend agent handler (SSH proxy)
- Bundle into VM image

### [Phase 2: Frontend Integration](./agent-service/phase-2-frontend.md) ✅
Connect frontend to agent via Go backend.
- Implement `useAgentConnection` hook
- Update `AgentWidget` component
- Settings UI (model, permission mode, extended thinking)

### [Phase 3: Multi-Agent](./agent-service/phase-3-multi-agent.md) 🔄
Add Codex and OpenCode support.
- CodexProvider using Codex CLI
- OpenCodeProvider
- Agent selector UI

### [Phase 4: Production](./agent-service/phase-4-production.md)
Production hardening.
- Reconnection handling
- Rate limiting
- Usage tracking

---

## Success Metrics

1. **Reliability**: <1% failed sessions (vs >10% with PTY parsing)
2. **Latency**: First response <2s
3. **Agent parity**: All three agents working with same UX
