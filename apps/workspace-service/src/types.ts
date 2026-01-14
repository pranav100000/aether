// =============================================================================
// Agent Types
// =============================================================================

export type AgentType = "claude" | "codex" | "codebuff" | "opencode"

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

// =============================================================================
// Provider Interface
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
    status: "pending" | "running" | "complete"
  }
  toolId?: string
  result?: string
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
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

// =============================================================================
// WebSocket Protocol
// =============================================================================

/** Server -> Client messages (extends AgentEvent with server-only types) */
export interface ServerMessage {
  type: AgentEvent["type"] | "init" | "history"
  sessionId?: string
  history?: StoredMessage[]
  agent?: AgentType
  // From AgentEvent
  content?: string
  streaming?: boolean
  tool?: AgentEvent["tool"]
  toolId?: string
  result?: string
  error?: string
  usage?: AgentEvent["usage"]
}

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
  selection?: { startLine: number; endLine: number }
}

/** Binary attachment */
export interface Attachment {
  filename: string
  mediaType: string
  data: string
}

/** Context sent with prompt */
export interface PromptContext {
  files?: FileReference[]
  attachments?: Attachment[]
}

/** Client -> Server messages */
export interface ClientMessage {
  type: "prompt" | "abort" | "approve" | "reject" | "settings"
  prompt?: string
  toolId?: string
  settings?: AgentSettings
  context?: PromptContext
}

// =============================================================================
// Storage
// =============================================================================

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

export interface ChatHistory {
  agent: AgentType
  sessionId: string
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
}
