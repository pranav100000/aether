// =============================================================================
// Agent Types - Shared across web, workspace-service, and API
// =============================================================================

/** Supported AI agent types */
export type AgentType = "claude" | "codex" | "codebuff" | "opencode"

/** Permission modes for agent tool execution */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

/** Tool execution status */
export type ToolStatus = "pending" | "running" | "complete" | "error"

// =============================================================================
// WebSocket Protocol - Server Messages
// =============================================================================

/** Server -> Client message types */
export type ServerMessageType =
  | "init"
  | "history"
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "done"
  | "error"

/** Tool data in messages */
export interface ToolData {
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
}

/** Usage/cost tracking */
export interface UsageStats {
  inputTokens: number
  outputTokens: number
  cost?: number
}

/** Server -> Client message */
export interface ServerMessage {
  type: ServerMessageType
  sessionId?: string
  history?: StoredMessage[]
  agent?: AgentType
  content?: string
  streaming?: boolean
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: ToolStatus
  }
  toolId?: string
  result?: string
  usage?: UsageStats
  error?: string
}

// =============================================================================
// WebSocket Protocol - Client Messages
// =============================================================================

/** Client -> Server message types */
export type ClientMessageType = "prompt" | "abort" | "approve" | "reject" | "settings"

/** Agent settings from client */
export interface AgentSettings {
  model?: string
  permissionMode?: PermissionMode
  extendedThinking?: boolean
}

/** File reference in prompt context */
export interface FileReference {
  path: string
  include: boolean
  selection?: {
    startLine: number
    endLine: number
  }
}

/** Binary attachment (images, etc.) */
export interface Attachment {
  filename: string
  mediaType: string
  data: string // base64 encoded
}

/** Context sent with prompt */
export interface PromptContext {
  files?: FileReference[]
  attachments?: Attachment[]
}

/** Client -> Server message */
export interface ClientMessage {
  type: ClientMessageType
  prompt?: string
  toolId?: string
  settings?: AgentSettings
  context?: PromptContext
}

// =============================================================================
// Storage Types
// =============================================================================

/** Stored message in history */
export interface StoredMessage {
  id: string
  timestamp: number
  role: "user" | "assistant" | "system"
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

/** Chat history for a session */
export interface ChatHistory {
  agent: AgentType
  sessionId: string
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
}

// =============================================================================
// Provider Types (workspace-service only)
// =============================================================================

/** Options for initializing a provider session */
export interface ProviderConfig {
  cwd: string
}

/** Options for a single query */
export interface QueryOptions {
  model?: string
  autoApprove: boolean
  thinkingTokens?: number
}

/** Events emitted by providers */
export interface AgentEvent {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "done" | "error"
  content?: string
  streaming?: boolean
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: ToolStatus
  }
  toolId?: string
  result?: string
  error?: string
  usage?: UsageStats
}

/** Provider interface - all agent implementations must satisfy this */
export interface AgentProvider {
  readonly name: AgentType
  isConfigured(): boolean
  query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent>
  abort(): void
}

/** Factory function type for creating providers */
export type ProviderFactory = (config: ProviderConfig) => AgentProvider
