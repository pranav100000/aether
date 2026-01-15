# Phase 2: Frontend Integration

## Goal

Connect the frontend to the agent via Go backend. The frontend connects to the same backend it uses for terminal, just a different endpoint.

## Prerequisites

- Phase 1 complete (agent CLI + Go backend handler)

## Scope

- New `useAgentConnection` hook
- Update `AgentChat` component
- Tool approval UI
- Connect to Go backend WebSocket (not separate service)

## Out of Scope

- Codex / OpenCode (Phase 3)
- Session persistence (Phase 4)

---

## Architecture

```
Frontend
    │
    │ WebSocket: /projects/:id/agent/claude
    │ (same backend as terminal)
    ▼
Go Backend
    │
    │ SSH → Agent CLI
    ▼
Project VM
```

**Key point**: Frontend connects to the **Go backend**, not a separate agent service. Same origin, same auth.

---

## Deliverables

### 1. New Hook: useAgentConnection

```typescript
// frontend/src/hooks/useAgentConnection.ts

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "./useAuth";

type AgentType = "claude" | "codex" | "opencode";

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "running" | "complete";
}

interface AgentMessage {
  type: "init" | "text" | "tool_use" | "tool_result" | "thinking" | "error" | "done";
  agent: AgentType;
  sessionId?: string;
  content?: string;
  streaming?: boolean;
  tool?: ToolUse;
  toolId?: string;
  result?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolUse?: ToolUse;
}

interface UseAgentConnectionOptions {
  projectId: string;
  agent: AgentType;
  enabled?: boolean;
}

interface UseAgentConnectionReturn {
  isConnected: boolean;
  sessionId: string | null;
  messages: ChatMessage[];
  isThinking: boolean;
  pendingToolCalls: ToolUse[];
  usage: { inputTokens: number; outputTokens: number; cost: number } | null;

  sendPrompt: (text: string) => void;
  approve: (toolId: string) => void;
  reject: (toolId: string) => void;
  abort: () => void;
  configure: (config: { autoApprove?: boolean }) => void;
  clear: () => void;
}

export function useAgentConnection({
  projectId,
  agent,
  enabled = true,
}: UseAgentConnectionOptions): UseAgentConnectionReturn {
  const { session } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolUse[]>([]);
  const [usage, setUsage] = useState<UseAgentConnectionReturn["usage"]>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const messageIdRef = useRef(0);

  const generateId = () => `msg-${Date.now()}-${++messageIdRef.current}`;

  // Handle incoming messages
  const handleMessage = useCallback((msg: AgentMessage) => {
    switch (msg.type) {
      case "init":
        setSessionId(msg.sessionId ?? null);
        break;

      case "text":
        if (msg.content) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && msg.streaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + msg.content }];
            }
            return [
              ...prev,
              {
                id: generateId(),
                role: "assistant",
                content: msg.content,
                timestamp: Date.now(),
              },
            ];
          });
        }
        break;

      case "tool_use":
        if (msg.tool) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "tool",
              content: `${msg.tool.name}: ${JSON.stringify(msg.tool.input)}`,
              timestamp: Date.now(),
              toolUse: msg.tool,
            },
          ]);
          if (msg.tool.status === "pending") {
            setPendingToolCalls((prev) => [...prev, msg.tool!]);
          }
        }
        break;

      case "tool_result":
        setMessages((prev) =>
          prev.map((m) =>
            m.toolUse?.id === msg.toolId
              ? {
                  ...m,
                  toolUse: { ...m.toolUse!, status: "complete" },
                  content: m.content + "\n→ " + msg.result,
                }
              : m
          )
        );
        setPendingToolCalls((prev) => prev.filter((t) => t.id !== msg.toolId));
        break;

      case "thinking":
        setIsThinking(true);
        break;

      case "error":
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "system",
            content: `Error: ${msg.error}`,
            timestamp: Date.now(),
          },
        ]);
        setIsThinking(false);
        break;

      case "done":
        setIsThinking(false);
        if (msg.usage) {
          setUsage(msg.usage);
        }
        break;
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    if (!enabled || !session?.access_token) return;

    let ws: WebSocket | null = null;

    const connect = () => {
      // Connect to Go backend (same origin as terminal)
      const wsUrl = getAgentUrl(projectId, agent);
      ws = new WebSocket(wsUrl, ["bearer", session.access_token]);

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg: AgentMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch {
          console.error("Failed to parse message:", event.data);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      ws?.close();
      wsRef.current = null;
    };
  }, [projectId, agent, enabled, session?.access_token, handleMessage]);

  // Actions
  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendPrompt = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      ]);
      setIsThinking(true);
      send({ type: "prompt", prompt: text });
    },
    [send]
  );

  const approve = useCallback(
    (toolId: string) => {
      send({ type: "approve", toolId });
      setPendingToolCalls((prev) =>
        prev.map((t) => (t.id === toolId ? { ...t, status: "running" } : t))
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.toolUse?.id === toolId ? { ...m, toolUse: { ...m.toolUse!, status: "running" } } : m
        )
      );
    },
    [send]
  );

  const reject = useCallback(
    (toolId: string) => {
      send({ type: "reject", toolId });
      setPendingToolCalls((prev) => prev.filter((t) => t.id !== toolId));
      setMessages((prev) =>
        prev.map((m) =>
          m.toolUse?.id === toolId ? { ...m, toolUse: { ...m.toolUse!, status: "rejected" } } : m
        )
      );
    },
    [send]
  );

  const abort = useCallback(() => {
    send({ type: "abort" });
    setIsThinking(false);
  }, [send]);

  const configure = useCallback(
    (config: { autoApprove?: boolean }) => {
      send({ type: "config", config });
    },
    [send]
  );

  const clear = useCallback(() => {
    setMessages([]);
    setPendingToolCalls([]);
    setUsage(null);
  }, []);

  return {
    isConnected,
    sessionId,
    messages,
    isThinking,
    pendingToolCalls,
    usage,
    sendPrompt,
    approve,
    reject,
    abort,
    configure,
    clear,
  };
}

function getAgentUrl(projectId: string, agent: AgentType): string {
  // Use same backend as terminal - just different endpoint
  const backendUrl = import.meta.env.VITE_API_URL || "";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = backendUrl.replace(/^https?:\/\//, "") || window.location.host;
  return `${wsProtocol}//${host}/projects/${projectId}/agent/${agent}`;
}
```

---

### 2. Updated AgentChat Component

```typescript
// frontend/src/components/workspace/AgentWidget/AgentChat.tsx

import { useRef, useEffect } from 'react'
import { useAgentConnection } from '@/hooks/useAgentConnection'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'

interface AgentChatProps {
  projectId: string
  agent: 'claude' | 'codex' | 'opencode'
  isActive: boolean
  autoApprove?: boolean
  onUsageUpdate?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void
}

export function AgentChat({
  projectId,
  agent,
  isActive,
  autoApprove = false,
  onUsageUpdate,
}: AgentChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    isConnected,
    messages,
    isThinking,
    usage,
    sendPrompt,
    approve,
    reject,
    abort,
    configure,
  } = useAgentConnection({
    projectId,
    agent,
    enabled: isActive,
  })

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus when active
  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus()
    }
  }, [isActive])

  // Configure auto-approve
  useEffect(() => {
    configure({ autoApprove })
  }, [autoApprove, configure])

  // Report usage
  useEffect(() => {
    if (usage) {
      onUsageUpdate?.(usage)
    }
  }, [usage, onUsageUpdate])

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">Start a conversation with {agent}...</p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onApprove={message.toolUse?.status === 'pending' ? () => approve(message.toolUse!.id) : undefined}
              onReject={message.toolUse?.status === 'pending' ? () => reject(message.toolUse!.id) : undefined}
            />
          ))
        )}

        {isThinking && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="animate-pulse">Thinking...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        ref={inputRef}
        onSend={sendPrompt}
        onAbort={abort}
        disabled={!isConnected}
        isProcessing={isThinking}
        placeholder={isConnected ? 'Type your message...' : 'Connecting...'}
      />
    </div>
  )
}
```

---

### 3. Tool Approval UI

```typescript
// frontend/src/components/workspace/AgentWidget/ToolApprovalCard.tsx

import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'

interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'running' | 'complete'
}

interface ToolApprovalCardProps {
  tool: ToolUse
  onApprove: () => void
  onReject: () => void
}

export function ToolApprovalCard({ tool, onApprove, onReject }: ToolApprovalCardProps) {
  const isPending = tool.status === 'pending'

  return (
    <div className="border border-border rounded-lg p-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{tool.name}</span>
          <StatusBadge status={tool.status} />
        </div>

        {isPending && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onReject}>
              <X className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="default" onClick={onApprove}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <pre className="mt-2 text-xs text-muted-foreground overflow-x-auto">
        {JSON.stringify(tool.input, null, 2)}
      </pre>
    </div>
  )
}

function StatusBadge({ status }: { status: ToolUse['status'] }) {
  const colors = {
    pending: 'bg-yellow-500/20 text-yellow-500',
    approved: 'bg-blue-500/20 text-blue-500',
    rejected: 'bg-red-500/20 text-red-500',
    running: 'bg-blue-500/20 text-blue-500',
    complete: 'bg-green-500/20 text-green-500',
  }

  return (
    <span className={`px-2 py-0.5 rounded text-xs ${colors[status]}`}>
      {status}
    </span>
  )
}
```

---

### 4. ChatMessage Component

```typescript
// frontend/src/components/workspace/AgentWidget/ChatMessage.tsx

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ToolApprovalCard } from './ToolApprovalCard'

interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'running' | 'complete'
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolUse?: ToolUse
}

interface ChatMessageProps {
  message: Message
  onApprove?: () => void
  onReject?: () => void
}

export function ChatMessage({ message, onApprove, onReject }: ChatMessageProps) {
  // Tool messages
  if (message.role === 'tool' && message.toolUse) {
    return (
      <ToolApprovalCard
        tool={message.toolUse}
        onApprove={onApprove ?? (() => {})}
        onReject={onReject ?? (() => {})}
      />
    )
  }

  // User messages
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]">
          {message.content}
        </div>
      </div>
    )
  }

  // System messages
  if (message.role === 'system') {
    return (
      <div className="text-center text-sm text-muted-foreground py-2">
        {message.content}
      </div>
    )
  }

  // Assistant messages
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-lg px-4 py-2 max-w-[80%] prose prose-invert prose-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
```

---

## No Environment Variable Needed

The frontend connects to the **same backend** it already uses. No new `VITE_AGENT_SERVICE_URL` needed.

```typescript
// Uses existing VITE_API_URL or same origin
const host = import.meta.env.VITE_API_URL || window.location.origin;
```

---

## Testing

1. Ensure Go backend has agent handler (Phase 1)
2. Ensure VM has agent CLI installed (Phase 1)
3. Open project in frontend
4. Switch to agent tab
5. Send a prompt
6. Verify messages render correctly
7. Test tool approval flow
8. Test abort

---

## Success Criteria

1. Agent tab connects via Go backend
2. Messages render with markdown formatting
3. Tool calls show approval UI
4. Approve/reject works
5. Thinking indicator shows during processing
6. Usage stats display after completion

---

## Next Phase

Once frontend integration is complete, proceed to [Phase 3: Multi-Agent](./phase-3-multi-agent.md).
