// Agent types shared across frontend components
// Keep in sync with workspace-service/src/types.ts

export type AgentType = "claude" | "codex" | "codebuff" | "opencode"

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

export type ToolStatus = "pending" | "running" | "complete" | "error"

// Server -> Client message types
export type ServerMessageType =
  | "init"
  | "history"
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "done"
  | "error"

// Client -> Server message types
export type ClientMessageType = "prompt" | "abort" | "approve" | "reject" | "settings"

// Tool data structure
export interface ToolData {
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
}

// History message (stored/restored)
export interface HistoryMessage {
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

// Usage/cost tracking
export interface UsageStats {
  inputTokens: number
  outputTokens: number
  cost: number
}

// Server -> Client Messages
export interface ServerMessage {
  type: ServerMessageType
  sessionId?: string
  history?: HistoryMessage[]
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

// Client -> Server Messages
export interface AgentSettings {
  model?: string
  permissionMode?: PermissionMode
  extendedThinking?: boolean
}

export interface PromptContext {
  files?: Array<{
    path: string
    include: boolean
    selection?: {
      startLine: number
      endLine: number
    }
  }>
  attachments?: Array<{
    filename: string
    mediaType: string
    data: string
  }>
}

export interface ClientMessage {
  type: ClientMessageType
  prompt?: string
  toolId?: string
  settings?: AgentSettings
  context?: PromptContext
}
