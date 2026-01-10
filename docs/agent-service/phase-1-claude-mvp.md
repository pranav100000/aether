# Phase 1: Claude Code MVP

## Goal

Get Claude Code working end-to-end with the Agent SDK. Proves the architecture before adding complexity.

## Scope

- Agent CLI with stdin/stdout JSON protocol
- Claude Agent SDK integration
- Go backend agent handler (SSH proxy)
- Bundle into project VM image

## Out of Scope (Later Phases)

- Codex / OpenCode support
- Frontend changes (use existing UI, just swap connection)
- Rate limiting
- Usage tracking

---

## Architecture

```
Frontend
    │
    │ WebSocket: /projects/:id/agent/claude
    ▼
Go Backend
    │
    │ SSH to VM (port 2222)
    │ Run: bun /opt/agent-service/src/cli.ts claude
    ▼
Project VM
    └── Agent CLI (stdin/stdout JSON)
        └── Claude Agent SDK
            └── Works on /home/coder/project
```

**Key insight**: Same pattern as terminal - Go backend SSHs in and runs a command. For terminal it's a shell, for agent it's the CLI.

---

## Deliverables

### 1. Project Structure

```bash
agent-service/
├── src/
│   ├── cli.ts              # Main CLI entry point
│   ├── types.ts            # Shared types
│   │
│   ├── agents/
│   │   ├── base.ts         # AgentProvider interface
│   │   ├── claude.ts       # ClaudeProvider implementation
│   │   └── index.ts        # Provider registry
│   │
│   └── utils/
│       └── readline.ts     # JSON line reader
│
├── package.json
└── tsconfig.json
```

### 2. Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

---

## Implementation Details

### CLI Entry Point (cli.ts)

```typescript
import { getProvider } from "./agents";
import type { AgentType, ClientMessage, AgentMessage } from "./types";

const agent = process.argv[2] as AgentType;

if (!agent) {
  console.error("Usage: bun cli.ts <agent>");
  process.exit(1);
}

const provider = getProvider(agent);

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
      if (!msg.prompt) {
        send({ type: "error", agent, error: "No prompt provided" });
        return;
      }

      for await (const agentMsg of provider.query(msg.prompt, {
        cwd: "/home/coder/project",
        autoApprove: false,
      })) {
        send({ ...agentMsg, agent });
      }
      break;

    case "approve":
      provider.approveToolUse?.(msg.toolId!);
      break;

    case "reject":
      provider.rejectToolUse?.(msg.toolId!);
      break;

    case "abort":
      provider.abort();
      send({ type: "done", agent });
      break;

    case "config":
      // Handle config updates
      break;
  }
}

function send(msg: AgentMessage & { agent: AgentType }) {
  console.log(JSON.stringify(msg));
}
```

### Agent Provider Interface (agents/base.ts)

```typescript
export type AgentType = "claude" | "codex" | "opencode" | "codebuff";

export interface AgentConfig {
  cwd: string;
  autoApprove: boolean;
  model?: string;
}

export interface AgentMessage {
  type: "init" | "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  sessionId?: string;
  content?: string;
  streaming?: boolean;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: "pending" | "running" | "complete";
  };
  toolId?: string;
  result?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
  error?: string;
}

export interface AgentProvider {
  readonly name: AgentType;

  isConfigured(): boolean;
  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>;
  approveToolUse?(toolId: string): void;
  rejectToolUse?(toolId: string): void;
  abort(): void;
}
```

### Claude Provider (agents/claude.ts)

```typescript
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

    try {
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
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        yield { type: "error", error: String(err) };
      }
    }
  }

  private mapMessage(msg: unknown, config: AgentConfig): AgentMessage {
    const m = msg as Record<string, unknown>;

    // Text content
    if (m.type === "assistant" && m.message) {
      const message = m.message as { content?: Array<{ type: string; text?: string }> };
      const textBlock = message.content?.find(b => b.type === "text");
      if (textBlock?.text) {
        return { type: "text", content: textBlock.text, streaming: false };
      }
    }

    // Tool use
    if (m.type === "assistant" && m.message) {
      const message = m.message as { content?: Array<{ type: string; id?: string; name?: string; input?: unknown }> };
      const toolBlock = message.content?.find(b => b.type === "tool_use");
      if (toolBlock) {
        return {
          type: "tool_use",
          tool: {
            id: toolBlock.id as string,
            name: toolBlock.name as string,
            input: toolBlock.input as Record<string, unknown>,
            status: config.autoApprove ? "running" : "pending",
          },
        };
      }
    }

    // Tool result
    if (m.type === "user" && m.message) {
      const message = m.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string }> };
      const resultBlock = message.content?.find(b => b.type === "tool_result");
      if (resultBlock) {
        return {
          type: "tool_result",
          toolId: resultBlock.tool_use_id,
          result: resultBlock.content,
        };
      }
    }

    // Result (final)
    if ("result" in m) {
      return {
        type: "done",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        },
      };
    }

    // System messages (init, etc)
    if (m.type === "system" && m.subtype === "init") {
      return { type: "init", sessionId: m.session_id as string };
    }

    return { type: "text", content: "" };
  }

  abort(): void {
    this.abortController?.abort();
  }
}
```

### Provider Registry (agents/index.ts)

```typescript
import type { AgentProvider, AgentType } from "./base";
import { ClaudeProvider } from "./claude";

const providers: Partial<Record<AgentType, AgentProvider>> = {
  claude: new ClaudeProvider(),
  // codex: Phase 3
  // opencode: Phase 3
};

export function getProvider(agent: AgentType): AgentProvider {
  const provider = providers[agent];
  if (!provider) {
    throw new Error(`Agent ${agent} not available yet`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Agent ${agent} not configured (missing API key)`);
  }
  return provider;
}

export * from "./base";
```

### Types (types.ts)

```typescript
export type { AgentType, AgentConfig, AgentMessage } from "./agents/base";

// Client → Agent message (via stdin)
export interface ClientMessage {
  type: "prompt" | "approve" | "reject" | "abort" | "config";
  prompt?: string;
  toolId?: string;
  config?: {
    autoApprove?: boolean;
    model?: string;
  };
}
```

---

## Go Backend Changes

### New Handler (handlers/agent.go)

```go
package handlers

import (
	"bufio"
	"fmt"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

func (h *Handler) HandleAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	projectID := chi.URLParam(r, "id")
	agent := chi.URLParam(r, "agent")

	// Get user from context (auth middleware)
	userID := authmw.GetUserID(ctx)

	// Get project and verify ownership
	project, err := h.db.GetProject(ctx, projectID)
	if err != nil || project.UserID != userID {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	// Ensure machine is running
	if project.Status != "running" {
		http.Error(w, "Project not running", http.StatusBadRequest)
		return
	}

	// Get machine IP
	machine, err := h.fly.GetMachine(project.FlyMachineID)
	if err != nil {
		http.Error(w, "Failed to get machine", http.StatusInternalServerError)
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// SSH to VM
	sshSession, err := h.sshClient.ConnectWithRetry(machine.PrivateIP, 2222, 5, 2*time.Second)
	if err != nil {
		conn.WriteJSON(map[string]string{"type": "error", "error": "Failed to connect to VM"})
		return
	}
	defer sshSession.Close()

	// Get stdin/stdout pipes
	stdin, _ := sshSession.StdinPipe()
	stdout, _ := sshSession.StdoutPipe()

	// Run agent CLI
	cmd := fmt.Sprintf("cd /home/coder/project && bun /opt/agent-service/src/cli.ts %s", agent)
	if err := sshSession.Start(cmd); err != nil {
		conn.WriteJSON(map[string]string{"type": "error", "error": "Failed to start agent"})
		return
	}

	// Proxy WebSocket → stdin
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				stdin.Close()
				return
			}
			stdin.Write(append(msg, '\n'))
		}
	}()

	// Proxy stdout → WebSocket
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if err := conn.WriteMessage(websocket.TextMessage, scanner.Bytes()); err != nil {
			return
		}
	}

	sshSession.Wait()
}
```

### Add Route (main.go)

```go
// In the protected routes section
r.Route("/projects", func(r chi.Router) {
	r.Use(authmw.Middleware)

	// ... existing routes ...

	// Agent WebSocket
	r.Get("/{id}/agent/{agent}", handler.HandleAgent)
})
```

---

## VM Image Changes

### Install Agent CLI

Add to the VM Dockerfile:

```dockerfile
# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Copy agent service
COPY agent-service /opt/agent-service
WORKDIR /opt/agent-service
RUN bun install

# Back to default workdir
WORKDIR /home/coder
```

### Environment Variables

Set in VM startup or Fly secrets:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Testing

### Local CLI Test

```bash
cd agent-service
ANTHROPIC_API_KEY=sk-ant-... bun src/cli.ts claude

# Then type JSON messages:
{"type":"prompt","prompt":"What files are in this directory?"}
```

### Local Integration Test

```bash
# Terminal 1: Run CLI
cd agent-service
ANTHROPIC_API_KEY=... bun src/cli.ts claude

# Terminal 2: Send messages
echo '{"type":"prompt","prompt":"List files"}' | nc localhost 3000
```

### End-to-End Test

1. Deploy VM with agent-service installed
2. Connect via Go backend WebSocket
3. Send prompt → verify Claude responds
4. Verify tool calls work on `/home/coder/project`

---

## Success Criteria

1. Agent CLI reads JSON from stdin, writes JSON to stdout
2. Go backend successfully proxies WebSocket ↔ SSH ↔ CLI
3. Claude responds to prompts with structured messages
4. Tool calls (Read, Edit, Bash) work on project files
5. Abort cleanly terminates the agent

---

## Next Phase

Once Claude MVP is working, proceed to [Phase 2: Frontend Integration](./phase-2-frontend.md).
