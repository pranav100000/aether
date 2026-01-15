// Re-export agent types from shared package
// This file maintains backwards compatibility for existing imports

export {
  // Core types
  type AgentType,
  type PermissionMode,
  type ToolStatus,

  // Server message types
  type ServerMessageType,
  type ToolData,
  type UsageStats,
  type ServerMessage,

  // Client message types
  type ClientMessageType,
  type AgentSettings,
  type FileReference,
  type Attachment,
  type PromptContext,
  type ClientMessage,

  // Human-in-the-loop types
  type ToolResponsePayload,
  type AskUserResponse,

  // Storage types
  type StoredMessage,
  type ChatHistory,
} from "@aether/types";

// Backwards compatibility alias
export type { StoredMessage as HistoryMessage } from "@aether/types";
