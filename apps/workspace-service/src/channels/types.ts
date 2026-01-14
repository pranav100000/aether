/**
 * Channel-based message types for unified WebSocket communication.
 * All messages have a `channel` field for routing.
 */

export type Channel = "terminal" | "agent" | "files" | "ports"

// =============================================================================
// Base Message
// =============================================================================

export interface BaseMessage {
  channel: Channel
}

// =============================================================================
// Terminal Channel
// =============================================================================

export interface TerminalInputMessage extends BaseMessage {
  channel: "terminal"
  type: "input"
  data: string
}

export interface TerminalOutputMessage extends BaseMessage {
  channel: "terminal"
  type: "output"
  data: string
}

export interface TerminalResizeMessage extends BaseMessage {
  channel: "terminal"
  type: "resize"
  cols: number
  rows: number
}

export type TerminalMessage = TerminalInputMessage | TerminalOutputMessage | TerminalResizeMessage

// =============================================================================
// Agent Channel (existing types, wrapped with channel)
// =============================================================================

export interface AgentMessage extends BaseMessage {
  channel: "agent"
  type: string
  agent?: string
  [key: string]: unknown
}

// =============================================================================
// Files Channel
// =============================================================================

export interface FileChangeMessage extends BaseMessage {
  channel: "files"
  type: "change"
  action: "create" | "modify" | "delete"
  path: string
  isDirectory: boolean
}

export type FilesMessage = FileChangeMessage

// =============================================================================
// Ports Channel
// =============================================================================

export interface PortChangeMessage extends BaseMessage {
  channel: "ports"
  type: "change"
  action: "open" | "close"
  port: number
}

export type PortsMessage = PortChangeMessage

// =============================================================================
// Union Types
// =============================================================================

export type IncomingMessage = TerminalInputMessage | TerminalResizeMessage | AgentMessage
export type OutgoingMessage = TerminalOutputMessage | AgentMessage | FileChangeMessage | PortChangeMessage

// Type guard helpers
export function isTerminalMessage(msg: unknown): msg is TerminalMessage {
  return typeof msg === "object" && msg !== null && (msg as BaseMessage).channel === "terminal"
}

export function isAgentMessage(msg: unknown): msg is AgentMessage {
  return typeof msg === "object" && msg !== null && (msg as BaseMessage).channel === "agent"
}
