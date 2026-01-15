# Phase 3: Multi-Agent Support

## Goal

Add Codex and OpenCode support alongside Claude.

## Prerequisites

- Phase 1 complete (Claude working) ✅
- Phase 2 complete (Frontend integrated) ✅

## Scope

- Codex provider implementation using `@openai/codex-sdk`
- OpenCode provider implementation (TBD)
- Agent selection via CLI argument (already implemented)
- Per-agent settings

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

Already implemented in types.ts:

```typescript
// src/types.ts

export type AgentType = "claude" | "codex" | "opencode";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface AgentConfig {
  cwd: string;
  autoApprove: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  extendedThinking?: boolean;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentProvider {
  readonly name: AgentType;

  // Check if provider is configured (has API key)
  isConfigured(): boolean;

  // Send prompt and stream responses
  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>;

  // Tool approval (for providers that support it)
  approveToolUse?(toolId: string): void;
  rejectToolUse?(toolId: string): void;

  // Abort current operation
  abort(): void;
}
```

---

## Claude Provider (Implemented ✅)

Uses the Claude CLI with streaming JSON output:

```typescript
// src/agents/claude.ts

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const;
  private currentProc?: ReturnType<typeof Bun.spawn>;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    const args = [
      "claude",
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.permissionMode) {
      args.push("--permission-mode", config.permissionMode);
    }

    // Prepend conversation history to prompt
    let fullPrompt = prompt;
    if (config.conversationHistory?.length) {
      const historyText = config.conversationHistory
        .map((msg) => `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`)
        .join("\n\n");
      fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\nHuman: ${prompt}`;
    }

    args.push(fullPrompt);

    const proc = Bun.spawn(args, { cwd: config.cwd, stdout: "pipe", stderr: "pipe" });
    this.currentProc = proc;

    // Parse streaming JSON output...
    // (see actual implementation for full message mapping)
  }

  abort(): void {
    this.currentProc?.kill();
  }
}
```

---

## Codex Provider (To Implement)

Uses the `@openai/codex-sdk` TypeScript library with streaming events:

```typescript
// src/agents/codex.ts

import { Codex } from "@openai/codex-sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "../types";

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  private codex: Codex | null = null;
  private currentThread: ReturnType<Codex["startThread"]> | null = null;

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  private getCodex(): Codex {
    if (!this.codex) {
      this.codex = new Codex();
    }
    return this.codex;
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    const codex = this.getCodex();

    // Start or resume thread
    const thread = codex.startThread({
      workingDirectory: config.cwd,
    });
    this.currentThread = thread;

    // Build prompt with conversation history if available
    let fullPrompt = prompt;
    if (config.conversationHistory?.length) {
      const historyText = config.conversationHistory
        .map((msg) => `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`)
        .join("\n\n");
      fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\nHuman: ${prompt}`;
    }

    // Use runStreamed for real-time events
    const { events } = await thread.runStreamed(fullPrompt);

    for await (const event of events) {
      const mapped = this.mapEvent(event, config);
      if (mapped) {
        yield mapped;
      }
    }

    yield { type: "done" };
  }

  private mapEvent(
    event: { type: string; item?: unknown; usage?: unknown },
    config: AgentConfig
  ): AgentMessage | null {
    switch (event.type) {
      case "item.completed": {
        const item = event.item as Record<string, unknown>;

        // Handle text output
        if (item.type === "message" && item.role === "assistant") {
          const content = item.content as Array<{ type: string; text?: string }>;
          for (const block of content) {
            if (block.type === "text" && block.text) {
              return { type: "text", content: block.text, streaming: false };
            }
          }
        }

        // Handle tool use
        if (item.type === "function_call") {
          return {
            type: "tool_use",
            tool: {
              id: item.call_id as string,
              name: item.name as string,
              input: JSON.parse(item.arguments as string),
              status: config.autoApprove ? "running" : "pending",
            },
          };
        }

        // Handle tool result
        if (item.type === "function_call_output") {
          return {
            type: "tool_result",
            toolId: item.call_id as string,
            result: item.output as string,
          };
        }

        return null;
      }

      case "turn.completed": {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          return {
            type: "done",
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cost: 0, // Calculate based on model pricing
            },
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  abort(): void {
    // The SDK doesn't expose a direct abort method
    // Thread will be cleaned up on next run
    this.currentThread = null;
  }
}
```

### Codex SDK Installation

```bash
npm install @openai/codex-sdk
```

### Codex SDK Event Types

The SDK uses `runStreamed()` which yields events:

- `item.completed` - A message, tool call, or tool result is complete
- `turn.completed` - The entire turn is done, includes usage stats

---

## OpenCode Provider (TBD)

OpenCode integration will be determined based on their CLI/SDK availability.

```typescript
// src/agents/opencode.ts (placeholder)

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode" as const;

  isConfigured(): boolean {
    return !!process.env.OPENCODE_API_KEY;
  }

  async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
    yield { type: "error", error: "OpenCode provider not yet implemented" };
  }

  abort(): void {}
}
```

---

## Provider Registry (Already Implemented)

```typescript
// src/agents/index.ts

import type { AgentProvider, AgentType } from "../types";
import { ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { OpenCodeProvider } from "./opencode";

const providers: Record<AgentType, AgentProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  opencode: new OpenCodeProvider(),
};

export function getProvider(agent: AgentType): AgentProvider {
  const provider = providers[agent];
  if (!provider) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Agent ${agent} is not configured (missing API key)`);
  }
  return provider;
}
```

---

## Environment Variables (in VM)

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Codex (SDK uses CODEX_API_KEY, set automatically from OPENAI_API_KEY in entrypoint.sh)
OPENAI_API_KEY=sk-...
CODEX_API_KEY=sk-...  # Auto-set from OPENAI_API_KEY

# OpenCode (TBD)
OPENCODE_API_KEY=...

# Storage configuration
STORAGE_DIR=/home/coder/project/.aether
PROJECT_CWD=/home/coder/project
```

---

## Implementation Steps

### 1. Install Codex SDK

```bash
cd agent-service
bun add @openai/codex-sdk
```

### 2. Create Codex Provider

Create `src/agents/codex.ts` with the implementation above.

### 3. Test Locally

```bash
export OPENAI_API_KEY="sk-..."
echo '{"type":"prompt","prompt":"What files are in the current directory?"}' | bun ./src/cli.ts codex
```

### 4. Update VM Image

Ensure `@openai/codex-sdk` is installed in the VM image.

---

## Success Criteria

1. Codex agent connects and responds to prompts
2. Streaming events are properly mapped to our AgentMessage format
3. Conversation history is maintained across turns
4. Tool calls are visible in the UI
5. Error handling for missing API keys

---

## Next Phase

Once multi-agent support is complete, proceed to [Phase 4: Production Hardening](./phase-4-production.md).
