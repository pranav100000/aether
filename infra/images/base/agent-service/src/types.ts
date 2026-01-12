export interface CompletionRequest {
  provider: "claude" | "codex" | "codebuff" | "opencode";
  model: string;
  prompt: string;
  options?: CompletionOptions;
}

export interface CompletionOptions {
  maxTokens?: number;
  extendedThinking?: boolean;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  fileContext?: Array<{
    path: string;
    content?: string;
    selection?: { startLine: number; endLine: number };
  }>;
}

export interface StreamEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  content?: string;
  streaming?: boolean;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: string;
  };
  toolId?: string;
  result?: string;
  usage?: UsageInfo;
  error?: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

export interface SessionPayload {
  user_id: string;
  project_id: string;
  jti: string;
  exp: number;
  iat: number;
}

export interface UsageRecord {
  user_id: string;
  project_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  session_token_id: string;
  status: "pending" | "completed" | "failed";
}
