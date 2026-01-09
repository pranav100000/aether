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

export interface AgentMessage {
  type:
    | "init"
    | "history"
    | "text"
    | "tool_use"
    | "tool_result"
    | "thinking"
    | "done"
    | "error";
  sessionId?: string;
  history?: Array<{
    id: string;
    timestamp: number;
    role: "user" | "assistant" | "system";
    content: string;
    tool?: {
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: string;
      result?: string;
      error?: string;
    };
  }>;
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

export interface AgentSettings {
  model?: string;
  permissionMode?: PermissionMode;
  extendedThinking?: boolean;
}

export interface ClientMessage {
  type: "prompt" | "abort" | "approve" | "reject" | "settings";
  prompt?: string;
  toolId?: string;
  settings?: AgentSettings;
}

export interface AgentProvider {
  readonly name: AgentType;

  isConfigured(): boolean;

  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>;

  approveToolUse?(toolId: string): void;
  rejectToolUse?(toolId: string): void;

  abort(): void;
}
