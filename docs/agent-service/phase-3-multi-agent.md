# Phase 3: Multi-Agent Support

## Goal

Add Codex and OpenCode support alongside Claude. Create a unified agent abstraction.

## Prerequisites

- Phase 1 complete (Claude working)
- Phase 2 complete (Frontend integrated)

## Scope

- Codex provider implementation (OpenAI API)
- OpenCode provider implementation
- Agent selection via CLI argument
- Per-agent settings

Note: The `AgentProvider` interface is already defined in Phase 1. This phase implements the additional providers.

---

## Architecture

```
Frontend
    │
    │ WebSocket: /projects/:id/agent/:agent
    │ (agent = claude | codex | opencode)
    ▼
Go Backend
    │
    │ SSH → bun /opt/agent-service/src/cli.ts <agent>
    ▼
Project VM
    └── Agent CLI reads from stdin, writes to stdout
```

**Key point**: The `:agent` parameter is passed to the CLI. Each provider implements the same interface.

---

## Agent Provider Interface

```typescript
// src/agents/base.ts

export type AgentType = 'claude' | 'codex' | 'opencode'

export interface AgentConfig {
  cwd: string
  autoApprove: boolean
  model?: string
}

export interface AgentMessage {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'done' | 'error'
  sessionId?: string
  content?: string
  streaming?: boolean
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: 'pending' | 'running' | 'complete'
  }
  toolId?: string
  result?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cost: number
  }
  error?: string
}

export interface AgentProvider {
  readonly name: AgentType

  // Check if provider is configured (has API key)
  isConfigured(): boolean

  // Send prompt and stream responses
  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>

  // Tool approval (for providers that support it)
  approveToolUse?(toolId: string): void
  rejectToolUse?(toolId: string): void

  // Abort current operation
  abort(): void
}
```

---

## Claude Provider

Already implemented in Phase 1. See [phase-1-claude-mvp.md](./phase-1-claude-mvp.md) for the full implementation.

```typescript
// src/agents/claude.ts (summary)

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "./base";

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const;
  private abortController?: AbortController;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    this.abortController = new AbortController();

    for await (const msg of query({
      prompt,
      options: {
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: config.autoApprove ? "bypassPermissions" : "default",
      },
      cwd: config.cwd,
      signal: this.abortController.signal,
    })) {
      yield this.mapMessage(msg, config);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
```

---

## Codex Provider

```typescript
// src/agents/codex.ts

import OpenAI from 'openai'
import type { AgentProvider, AgentConfig, AgentMessage } from './base'

export class CodexProvider implements AgentProvider {
  readonly name = 'codex' as const
  private client: OpenAI | null = null
  private abortController?: AbortController
  private currentRunId?: string
  private currentThreadId?: string

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
    }
    return this.client
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    const client = this.getClient()
    this.abortController = new AbortController()

    // Create a thread for this conversation
    const thread = await client.beta.threads.create()
    this.currentThreadId = thread.id

    // Add message to thread
    await client.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: prompt,
    })

    // Create and stream run
    const run = await client.beta.threads.runs.create(thread.id, {
      model: config.model || 'gpt-4o',
      tools: [
        { type: 'code_interpreter' },
        { type: 'file_search' },
      ],
    })
    this.currentRunId = run.id

    // Poll for completion
    let status = run.status
    while (status === 'queued' || status === 'in_progress') {
      if (this.abortController.signal.aborted) {
        await client.beta.threads.runs.cancel(thread.id, run.id)
        return
      }

      yield { type: 'thinking' }

      await new Promise(resolve => setTimeout(resolve, 1000))
      const updatedRun = await client.beta.threads.runs.retrieve(thread.id, run.id)
      status = updatedRun.status

      // Handle tool calls that need action
      if (status === 'requires_action' && updatedRun.required_action) {
        const toolCalls = updatedRun.required_action.submit_tool_outputs.tool_calls

        for (const tc of toolCalls) {
          yield {
            type: 'tool_use',
            tool: {
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
              status: 'running', // Codex auto-approves
            },
          }
        }
      }
    }

    if (status === 'completed') {
      const messages = await client.beta.threads.messages.list(thread.id, {
        order: 'desc',
        limit: 1,
      })

      const lastMessage = messages.data[0]
      if (lastMessage?.role === 'assistant') {
        for (const content of lastMessage.content) {
          if (content.type === 'text') {
            yield { type: 'text', content: content.text.value }
          }
        }
      }

      yield { type: 'done' }
    } else if (status === 'failed') {
      yield { type: 'error', error: 'Codex run failed' }
    }

    // Clean up thread
    await client.beta.threads.del(thread.id).catch(() => {})
  }

  abort(): void {
    this.abortController?.abort()
    // Also cancel the run if in progress
    if (this.currentThreadId && this.currentRunId) {
      this.getClient().beta.threads.runs
        .cancel(this.currentThreadId, this.currentRunId)
        .catch(() => {})
    }
  }
}
```

---

## OpenCode Provider

```typescript
// src/agents/opencode.ts

import type { AgentProvider, AgentConfig, AgentMessage } from './base'

export class OpenCodeProvider implements AgentProvider {
  readonly name = 'opencode' as const
  private abortController?: AbortController
  private currentProc?: ReturnType<typeof Bun.spawn>

  isConfigured(): boolean {
    // Check if opencode CLI is available or API key is set
    return !!process.env.OPENCODE_API_KEY
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    this.abortController = new AbortController()

    // Use CLI with JSON output
    const proc = Bun.spawn(['opencode', '--json', '--non-interactive'], {
      cwd: config.cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    this.currentProc = proc

    // Send prompt
    proc.stdin.write(prompt + '\n')
    proc.stdin.end()

    // Stream output
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (this.abortController.signal.aborted) {
          proc.kill()
          return
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse JSON lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const msg = JSON.parse(line)
            yield this.mapMessage(msg)
          } catch {
            // Plain text output
            yield { type: 'text', content: line }
          }
        }
      }

      // Handle remaining buffer
      if (buffer.trim()) {
        yield { type: 'text', content: buffer }
      }

      yield { type: 'done' }
    } finally {
      reader.releaseLock()
    }
  }

  private mapMessage(msg: Record<string, unknown>): AgentMessage {
    // Map OpenCode JSON format to our format
    if (msg.type === 'text') {
      return { type: 'text', content: msg.content as string }
    }

    if (msg.type === 'tool') {
      return {
        type: 'tool_use',
        tool: {
          id: msg.id as string,
          name: msg.name as string,
          input: msg.input as Record<string, unknown>,
          status: 'running',
        },
      }
    }

    return { type: 'text', content: JSON.stringify(msg) }
  }

  abort(): void {
    this.abortController?.abort()
    this.currentProc?.kill()
  }
}
```

---

## Provider Registry

```typescript
// src/agents/index.ts

import type { AgentProvider, AgentType } from './base'
import { ClaudeProvider } from './claude'
import { CodexProvider } from './codex'
import { OpenCodeProvider } from './opencode'

const providers: Partial<Record<AgentType, AgentProvider>> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  opencode: new OpenCodeProvider(),
}

export function getProvider(agent: AgentType): AgentProvider {
  const provider = providers[agent]
  if (!provider) {
    throw new Error(`Unknown agent: ${agent}`)
  }
  if (!provider.isConfigured()) {
    throw new Error(`Agent ${agent} is not configured (missing API key)`)
  }
  return provider
}

export * from './base'
```

---

## Updated CLI

The CLI entry point handles all agents via the same interface:

```typescript
// src/cli.ts

import { getProvider } from "./agents";
import type { AgentType, ClientMessage, AgentMessage } from "./types";

const agent = process.argv[2] as AgentType;

if (!agent) {
  console.error("Usage: bun cli.ts <agent>");
  process.exit(1);
}

const provider = getProvider(agent);  // Works for claude, codex, or opencode

// Send init message
const sessionId = crypto.randomUUID();
send({ type: "init", agent, sessionId });

// Read JSON lines from stdin
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  const lines = decoder.decode(chunk).split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const msg: ClientMessage = JSON.parse(line);
      await handleMessage(msg);
    } catch (err) {
      send({ type: "error", agent, error: String(err) });
    }
  }
}

async function handleMessage(msg: ClientMessage) {
  switch (msg.type) {
    case "prompt":
      for await (const agentMsg of provider.query(msg.prompt!, {
        cwd: "/home/coder/project",
        autoApprove: false,
      })) {
        send({ ...agentMsg, agent });
      }
      break;

    case "abort":
      provider.abort();
      send({ type: "done", agent });
      break;
  }
}

function send(msg: AgentMessage & { agent: AgentType }) {
  console.log(JSON.stringify(msg));
}
```

---

## Frontend Updates

### Agent Selector

```typescript
// frontend/src/components/workspace/AgentWidget/AgentSelector.tsx

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type AgentType = 'claude' | 'codex' | 'opencode'

interface AgentSelectorProps {
  value: AgentType
  onChange: (agent: AgentType) => void
  availableAgents: AgentType[]
}

const agentInfo: Record<AgentType, { name: string; icon: string }> = {
  claude: { name: 'Claude Code', icon: '🤖' },
  codex: { name: 'Codex', icon: '🧠' },
  opencode: { name: 'OpenCode', icon: '💻' },
}

export function AgentSelector({ value, onChange, availableAgents }: AgentSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue>
          {agentInfo[value].icon} {agentInfo[value].name}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {availableAgents.map(agent => (
          <SelectItem key={agent} value={agent}>
            {agentInfo[agent].icon} {agentInfo[agent].name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

### useAgentConnection

The hook connects to Go backend (same origin as terminal), passing the selected agent:

```typescript
function getAgentUrl(projectId: string, agent: AgentType): string {
  // Use same backend as terminal - just different endpoint
  const backendUrl = import.meta.env.VITE_API_URL || ''
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = backendUrl.replace(/^https?:\/\//, '') || window.location.host
  return `${wsProtocol}//${host}/projects/${projectId}/agent/${agent}`
}
```

**Key point**: No new environment variable needed. Frontend connects to existing Go backend.

---

## Environment Variables (in VM)

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Codex
OPENAI_API_KEY=sk-...

# OpenCode
OPENCODE_API_KEY=...
```

Note: Go backend handles auth. These keys are in the VM environment.

---

## Success Criteria

1. All three agents connect and respond
2. Unified message format across agents
3. Agent selector works in UI
4. Per-agent tool handling works
5. Error handling for unavailable agents

---

## Next Phase

Once multi-agent support is complete, proceed to [Phase 4: Production Hardening](./phase-4-production.md).
