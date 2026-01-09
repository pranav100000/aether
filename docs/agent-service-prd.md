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

**SDK**: `@anthropic-ai/claude-agent-sdk`

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Fix the bug in auth.ts",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "default"
  }
})) {
  console.log(JSON.stringify(message));  // Structured output
}
```

**Built-in Tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch

### Codex (OpenAI)

**SDK**: `openai` (Responses API with code execution)

```typescript
import OpenAI from "openai";

const openai = new OpenAI();
const response = await openai.responses.create({
  model: "codex",
  input: prompt,
  tools: [{ type: "code_interpreter" }, { type: "file_search" }],
});
```

**Built-in Tools**: Code Interpreter, File Search

### OpenCode

**Integration**: CLI wrapper or direct API (TBD based on their SDK availability)

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
  type: 'prompt' | 'approve' | 'reject' | 'abort' | 'config'

  // For 'prompt'
  prompt?: string

  // For 'approve' / 'reject'
  toolId?: string

  // For 'config' - runtime settings
  config?: {
    autoApprove?: boolean      // Auto-approve tool calls
    model?: string             // Model override
  }
}
```

### Agent → Client Messages (stdout)

```typescript
interface AgentMessage {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done'

  // Which agent is responding
  agent: 'claude' | 'codex' | 'opencode'

  // Session info (type: 'init')
  sessionId?: string

  // Text content (type: 'text')
  content?: string
  streaming?: boolean

  // Tool usage (type: 'tool_use')
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: 'pending' | 'approved' | 'rejected' | 'running' | 'complete'
  }

  // Tool result (type: 'tool_result')
  toolId?: string
  result?: string

  // Thinking indicator (type: 'thinking')
  thinking?: boolean

  // Error (type: 'error')
  error?: string
  code?: string  // 'rate_limit' | 'auth' | 'tool_error' | 'unknown'

  // Usage stats (type: 'done')
  usage?: {
    inputTokens: number
    outputTokens: number
    cost: number
  }
}
```

---

## Agent Abstraction

Unified interface for all agents:

```typescript
// src/agents/base.ts
export type AgentType = 'claude' | 'codex' | 'opencode'

export interface AgentConfig {
  cwd: string
  autoApprove: boolean
  model?: string
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

---

## File Structure

```
agent-service/
├── src/
│   ├── cli.ts                # Main CLI entry point (stdin/stdout)
│   ├── types.ts              # Shared types
│   │
│   ├── agents/
│   │   ├── base.ts           # AgentProvider interface
│   │   ├── claude.ts         # Claude Agent SDK integration
│   │   ├── codex.ts          # OpenAI Codex integration
│   │   └── opencode.ts       # OpenCode integration
│   │
│   └── utils/
│       └── readline.ts       # JSON line reader for stdin
│
├── package.json
└── tsconfig.json
```

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

### [Phase 1: Claude MVP](./agent-service/phase-1-claude-mvp.md)
Get Claude Code working end-to-end with the Agent SDK.
- Agent CLI with stdin/stdout JSON protocol
- ClaudeProvider using Agent SDK
- Go backend agent handler (SSH proxy)
- Bundle into VM image

### [Phase 2: Frontend Integration](./agent-service/phase-2-frontend.md)
Connect frontend to agent via Go backend.
- Implement `useAgentConnection` hook
- Update `AgentWidget` component
- Tool approval UI

### [Phase 3: Multi-Agent](./agent-service/phase-3-multi-agent.md)
Add Codex and OpenCode support.
- CodexProvider (OpenAI API)
- OpenCodeProvider
- Agent selector UI

### [Phase 4: Production](./agent-service/phase-4-production.md)
Production hardening.
- Session persistence (optional)
- Reconnection handling
- Rate limiting
- Usage tracking

---

## Success Metrics

1. **Reliability**: <1% failed sessions (vs >10% with PTY parsing)
2. **Latency**: First response <2s
3. **Agent parity**: All three agents working with same UX
