// Re-export types from shared package
// This file maintains backwards compatibility for existing imports

export {
  // Core types
  type AgentType,
  type PermissionMode,
  type ToolStatus,

  // Provider types
  type ProviderConfig,
  type QueryOptions,
  type AgentEvent,
  type AgentProvider,
  type ProviderFactory,

  // Server message types
  type ServerMessage,

  // Client message types
  type AgentSettings,
  type FileReference,
  type Attachment,
  type PromptContext,
  type ClientMessage,

  // Storage types
  type StoredMessage,
  type ChatHistory,

  // Usage stats
  type UsageStats,
} from "@aether/types"
