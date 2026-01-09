export type AgentType = "claude" | "codex" | "opencode";

export interface AgentConfig {
  cwd: string;
  autoApprove: boolean;
  model?: string;
}

export interface AgentMessage {
  type:
    | "init"
    | "text"
    | "tool_use"
    | "tool_result"
    | "thinking"
    | "done"
    | "error";
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

export interface ClientMessage {
  type: "prompt" | "abort" | "approve" | "reject";
  prompt?: string;
  toolId?: string;
}

export interface AgentProvider {
  readonly name: AgentType;

  isConfigured(): boolean;

  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>;

  approveToolUse?(toolId: string): void;
  rejectToolUse?(toolId: string): void;

  abort(): void;
}
