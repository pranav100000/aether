/**
 * Channel-based message types for unified WebSocket communication.
 * All messages have a `channel` field for routing.
 */

export type Channel = "terminal" | "agent" | "files" | "ports";

// =============================================================================
// Base Message
// =============================================================================

export interface BaseMessage {
  channel: Channel;
}

// =============================================================================
// Terminal Channel
// =============================================================================

export interface TerminalInputMessage extends BaseMessage {
  channel: "terminal";
  type: "input";
  data: string;
}

export interface TerminalOutputMessage extends BaseMessage {
  channel: "terminal";
  type: "output";
  data: string;
}

export interface TerminalResizeMessage extends BaseMessage {
  channel: "terminal";
  type: "resize";
  cols: number;
  rows: number;
}

export type TerminalMessage = TerminalInputMessage | TerminalOutputMessage | TerminalResizeMessage;

// =============================================================================
// Agent Channel (existing types, wrapped with channel)
// =============================================================================

export interface AgentMessage extends BaseMessage {
  channel: "agent";
  type: string;
  agent?: string;
  [key: string]: unknown;
}

// =============================================================================
// Files Channel
// =============================================================================

// File change notification (outbound only - from file watcher)
export interface FileChangeMessage extends BaseMessage {
  channel: "files";
  type: "change";
  action: "create" | "modify" | "delete";
  path: string;
  isDirectory: boolean;
}

// File operation requests (inbound)
export interface FileRequestBase extends BaseMessage {
  channel: "files";
  requestId: string;
}

export interface FileReadRequest extends FileRequestBase {
  type: "read";
  path: string;
}

export interface FileWriteRequest extends FileRequestBase {
  type: "write";
  path: string;
  content: string;
  encoding: "utf8" | "base64";
}

export interface FileListRequest extends FileRequestBase {
  type: "list";
  path: string;
}

export interface FileListTreeRequest extends FileRequestBase {
  type: "listTree";
}

export interface FileMkdirRequest extends FileRequestBase {
  type: "mkdir";
  path: string;
}

export interface FileDeleteRequest extends FileRequestBase {
  type: "delete";
  path: string;
}

export interface FileRenameRequest extends FileRequestBase {
  type: "rename";
  oldPath: string;
  newPath: string;
}

export interface FileStatRequest extends FileRequestBase {
  type: "stat";
  path: string;
}

export type FileOperationRequest =
  | FileReadRequest
  | FileWriteRequest
  | FileListRequest
  | FileListTreeRequest
  | FileMkdirRequest
  | FileDeleteRequest
  | FileRenameRequest
  | FileStatRequest;

// File operation responses (outbound)
export interface FileResponseBase extends BaseMessage {
  channel: "files";
  requestId: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

export interface FileReadResponse extends FileResponseBase {
  type: "read";
  success: true;
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
  modified: string;
  isBinary: boolean;
}

export interface FileWriteResponse extends FileResponseBase {
  type: "write";
  success: true;
  path: string;
  size: number;
  modified: string;
}

export interface FileListResponse extends FileResponseBase {
  type: "list";
  success: true;
  path: string;
  entries: FileEntry[];
}

export interface FileListTreeResponse extends FileResponseBase {
  type: "listTree";
  success: true;
  paths: string[];
  directories: string[];
}

export interface FileMkdirResponse extends FileResponseBase {
  type: "mkdir";
  success: true;
  path: string;
}

export interface FileDeleteResponse extends FileResponseBase {
  type: "delete";
  success: true;
  path: string;
}

export interface FileRenameResponse extends FileResponseBase {
  type: "rename";
  success: true;
  oldPath: string;
  newPath: string;
}

export interface FileStatResponse extends FileResponseBase {
  type: "stat";
  success: true;
  path: string;
  fileType: "file" | "directory";
  size: number;
  modified: string;
}

export type FileErrorCode =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "IS_DIRECTORY"
  | "IS_FILE"
  | "FILE_TOO_LARGE"
  | "BINARY_FILE"
  | "INVALID_PATH"
  | "PATH_EXISTS"
  | "INTERNAL_ERROR";

export interface FileErrorResponse extends FileResponseBase {
  type: "error";
  success: false;
  error: string;
  code: FileErrorCode;
  path?: string;
}

export type FileOperationResponse =
  | FileReadResponse
  | FileWriteResponse
  | FileListResponse
  | FileListTreeResponse
  | FileMkdirResponse
  | FileDeleteResponse
  | FileRenameResponse
  | FileStatResponse
  | FileErrorResponse;

export type FilesMessage = FileChangeMessage | FileOperationResponse;

// =============================================================================
// Ports Channel
// =============================================================================

// Port change notification (outbound only - from port watcher)
export interface PortChangeMessage extends BaseMessage {
  channel: "ports";
  type: "change";
  action: "open" | "close";
  port: number;
}

// Port kill request (inbound)
export interface PortKillRequest extends BaseMessage {
  channel: "ports";
  requestId: string;
  type: "kill";
  port: number;
}

// Port kill response (outbound)
export interface PortKillResponse extends BaseMessage {
  channel: "ports";
  requestId: string;
  type: "killResponse";
  success: boolean;
  port: number;
  error?: string;
}

export type PortsMessage = PortChangeMessage | PortKillResponse;

// =============================================================================
// Union Types
// =============================================================================

export type IncomingMessage =
  | TerminalInputMessage
  | TerminalResizeMessage
  | AgentMessage
  | FileOperationRequest
  | PortKillRequest;

export type OutgoingMessage =
  | TerminalOutputMessage
  | AgentMessage
  | FileChangeMessage
  | FileOperationResponse
  | PortChangeMessage
  | PortKillResponse;

// =============================================================================
// Type Guards
// =============================================================================

export function isTerminalMessage(msg: unknown): msg is TerminalMessage {
  return typeof msg === "object" && msg !== null && (msg as BaseMessage).channel === "terminal";
}

export function isAgentMessage(msg: unknown): msg is AgentMessage {
  return typeof msg === "object" && msg !== null && (msg as BaseMessage).channel === "agent";
}

export function isFileOperationRequest(msg: unknown): msg is FileOperationRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.channel === "files" && typeof m.requestId === "string" && m.type !== "change";
}

export function isPortKillRequest(msg: unknown): msg is PortKillRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.channel === "ports" && m.type === "kill" && typeof m.requestId === "string";
}
