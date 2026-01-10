export type AgentType = "claude" | "codex" | "codebuff" | "opencode";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

// File context for @files references
export interface FileContext {
  path: string; // Relative path from project root
  content?: string; // File content (populated by CLI when include: true)
  selection?: {
    startLine: number;
    endLine: number;
  };
}

// Binary attachments (images, documents)
export interface Attachment {
  filename: string;
  mediaType: string;
  data: string; // Base64 encoded content
}

export interface AgentConfig {
  cwd: string;
  autoApprove: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  extendedThinking?: boolean;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  // File context passed with prompt
  fileContext?: FileContext[];
  // Binary attachments (images, PDFs)
  attachments?: Attachment[];
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

// Context sent with prompts from the frontend
export interface PromptContext {
  // File references from @files autocomplete
  files?: Array<{
    path: string; // Relative path from project root
    include: boolean; // Whether to read file content
    selection?: {
      startLine: number;
      endLine: number;
    };
  }>;
  // Binary attachments (images, documents)
  attachments?: Array<{
    filename: string;
    mediaType: string;
    data: string; // Base64 encoded content
  }>;
}

export interface ClientMessage {
  type: "prompt" | "abort" | "approve" | "reject" | "settings";
  prompt?: string;
  toolId?: string;
  settings?: AgentSettings;
  // Context attached to the prompt
  context?: PromptContext;
}

export interface AgentProvider {
  readonly name: AgentType;

  isConfigured(): boolean;

  query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage>;

  approveToolUse?(toolId: string): void;
  rejectToolUse?(toolId: string): void;

  abort(): void;
}
