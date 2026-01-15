import { useState, useRef, useCallback, useEffect } from "react"
import ReconnectingWebSocket from "reconnecting-websocket"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import type { FileInfo, FileTree, DirListing } from "@aether/types"
import type {
  AgentType,
  ServerMessage,
  AgentSettings,
  PromptContext,
} from "@/types/agent"

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

const FILE_OPERATION_TIMEOUT = 30000 // 30 seconds

// =============================================================================
// Terminal Channel Messages
// =============================================================================

interface TerminalInputMessage {
  channel: "terminal"
  type: "input"
  data: string
}

interface TerminalResizeMessage {
  channel: "terminal"
  type: "resize"
  cols: number
  rows: number
}

interface TerminalOutputMessage {
  channel: "terminal"
  type: "output"
  data: string
}

// =============================================================================
// File Channel Messages
// =============================================================================

// File change notification (from file watcher)
interface FileChangeMessage {
  channel: "files"
  type: "change"
  action: "create" | "modify" | "delete"
  path: string
  isDirectory: boolean
}

// File operation responses
interface FileReadResponse {
  channel: "files"
  type: "read"
  requestId: string
  success: true
  path: string
  content: string
  encoding: "utf8" | "base64"
  size: number
  modified: string
  isBinary: boolean
}

interface FileWriteResponse {
  channel: "files"
  type: "write"
  requestId: string
  success: true
  path: string
  size: number
  modified: string
}

interface FileListResponse {
  channel: "files"
  type: "list"
  requestId: string
  success: true
  path: string
  entries: Array<{
    name: string
    type: "file" | "directory"
    size: number
    modified: string
  }>
}

interface FileListTreeResponse {
  channel: "files"
  type: "listTree"
  requestId: string
  success: true
  paths: string[]
  directories: string[]
}

interface FileMkdirResponse {
  channel: "files"
  type: "mkdir"
  requestId: string
  success: true
  path: string
}

interface FileDeleteResponse {
  channel: "files"
  type: "delete"
  requestId: string
  success: true
  path: string
}

interface FileRenameResponse {
  channel: "files"
  type: "rename"
  requestId: string
  success: true
  oldPath: string
  newPath: string
}

interface FileErrorResponse {
  channel: "files"
  type: "error"
  requestId: string
  success: false
  error: string
  code: string
  path?: string
}

type FileOperationResponse =
  | FileReadResponse
  | FileWriteResponse
  | FileListResponse
  | FileListTreeResponse
  | FileMkdirResponse
  | FileDeleteResponse
  | FileRenameResponse
  | FileErrorResponse

// =============================================================================
// Port Channel Messages
// =============================================================================

// Port change notification (from port watcher)
interface PortChangeMessage {
  channel: "ports"
  type: "change"
  action: "open" | "close"
  port: number
}

// Port kill response
interface PortKillResponse {
  channel: "ports"
  type: "killResponse"
  requestId: string
  success: boolean
  port: number
  error?: string
}

// =============================================================================
// Agent Channel Messages
// =============================================================================

interface AgentChannelMessage extends ServerMessage {
  channel: "agent"
  agent?: AgentType
}

// =============================================================================
// Error Message
// =============================================================================

interface ErrorMessage {
  channel: "error"
  type: "error"
  error: string
}

// =============================================================================
// Union Types
// =============================================================================

type IncomingMessage =
  | TerminalOutputMessage
  | FileChangeMessage
  | FileOperationResponse
  | PortChangeMessage
  | PortKillResponse
  | AgentChannelMessage
  | ErrorMessage

// =============================================================================
// Pending Request Tracking
// =============================================================================

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

// =============================================================================
// Hook Options and Return Types
// =============================================================================

export interface UseWorkspaceConnectionOptions {
  projectId: string
  onTerminalOutput?: (data: string) => void
  onAgentMessage?: (message: ServerMessage) => void
  onFileChange?: (action: "create" | "modify" | "delete", path: string, isDirectory: boolean) => void
  onPortChange?: (action: "open" | "close", port: number) => void
  onError?: (error: string) => void
  onStatusChange?: (status: ConnectionStatus) => void
}

/**
 * File operations provider interface - can be passed to hooks that need file operations.
 * This allows hooks to use either WebSocket or REST API for file operations.
 */
export interface FileOperationsProvider {
  readFile: (path: string) => Promise<FileInfo>
  writeFile: (path: string, content: string) => Promise<FileInfo>
  listFiles: (path: string) => Promise<DirListing>
  listFilesTree: () => Promise<FileTree>
  mkdir: (path: string) => Promise<{ path: string }>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<{ path: string }>
}

export interface UseWorkspaceConnectionReturn {
  status: ConnectionStatus
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  // Terminal methods
  sendTerminalInput: (data: string) => void
  sendTerminalResize: (cols: number, rows: number) => void
  // Agent methods
  sendPrompt: (agent: AgentType, prompt: string, settings: AgentSettings, context?: PromptContext, history?: unknown[]) => void
  sendAbort: (agent: AgentType) => void
  sendApprove: (agent: AgentType, toolId: string) => void
  sendReject: (agent: AgentType, toolId: string) => void
  sendSettings: (agent: AgentType, settings: AgentSettings) => void
  // File operations (Promise-based) - implements FileOperationsProvider
  readFile: (path: string) => Promise<FileInfo>
  writeFile: (path: string, content: string) => Promise<FileInfo>
  listFiles: (path: string) => Promise<DirListing>
  listFilesTree: () => Promise<FileTree>
  mkdir: (path: string) => Promise<{ path: string }>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<{ path: string }>
  // Port operations (Promise-based)
  killPort: (port: number) => Promise<void>
}

export function useWorkspaceConnection({
  projectId,
  onTerminalOutput,
  onAgentMessage,
  onFileChange,
  onPortChange,
  onError,
  onStatusChange,
}: UseWorkspaceConnectionOptions): UseWorkspaceConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected")
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<ReconnectingWebSocket | null>(null)
  const connectionIdRef = useRef(0)

  // Pending requests for request/response correlation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingRequestsRef = useRef<Map<string, PendingRequest<any>>>(new Map())

  // Keep callback refs updated to avoid stale closures
  const onTerminalOutputRef = useRef(onTerminalOutput)
  const onAgentMessageRef = useRef(onAgentMessage)
  const onFileChangeRef = useRef(onFileChange)
  const onPortChangeRef = useRef(onPortChange)
  const onErrorRef = useRef(onError)
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    onTerminalOutputRef.current = onTerminalOutput
  }, [onTerminalOutput])

  useEffect(() => {
    onAgentMessageRef.current = onAgentMessage
  }, [onAgentMessage])

  useEffect(() => {
    onFileChangeRef.current = onFileChange
  }, [onFileChange])

  useEffect(() => {
    onPortChangeRef.current = onPortChange
  }, [onPortChange])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus)
    onStatusChangeRef.current?.(newStatus)
  }, [])

  const updateError = useCallback((err: string | null) => {
    setError(err)
    if (err) {
      onErrorRef.current?.(err)
    }
  }, [])

  const send = useCallback((message: unknown) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[useWorkspaceConnection] Cannot send - WebSocket not open")
      return false
    }
    wsRef.current.send(JSON.stringify(message))
    return true
  }, [])

  /**
   * Send a request and wait for a response with the matching requestId
   */
  const sendRequest = useCallback(<T,>(message: { requestId: string } & Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"))
        return
      }

      const { requestId } = message

      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId)
        reject(new Error("Request timed out"))
      }, FILE_OPERATION_TIMEOUT)

      pendingRequestsRef.current.set(requestId, { resolve, reject, timeout })

      wsRef.current.send(JSON.stringify(message))
    })
  }, [])

  /**
   * Handle response for a pending request
   */
  const handlePendingResponse = useCallback((requestId: string, success: boolean, data: unknown, error?: string) => {
    const pending = pendingRequestsRef.current.get(requestId)
    if (!pending) return false

    clearTimeout(pending.timeout)
    pendingRequestsRef.current.delete(requestId)

    if (success) {
      pending.resolve(data)
    } else {
      pending.reject(new Error(error || "Operation failed"))
    }

    return true
  }, [])

  const handleMessage = useCallback((data: string, connectionId: number) => {
    if (connectionIdRef.current !== connectionId) return

    try {
      const message = JSON.parse(data) as IncomingMessage
      console.log("[WS Message]", message.channel, message.type, message)

      switch (message.channel) {
        case "terminal":
          if (message.type === "output") {
            onTerminalOutputRef.current?.(message.data)
          }
          break

        case "agent": {
          const { channel: _, ...agentMessage } = message
          onAgentMessageRef.current?.(agentMessage)
          break
        }

        case "files":
          // Check if this is a response to a pending request
          if ("requestId" in message) {
            const fileResponse = message as FileOperationResponse
            if (fileResponse.success) {
              handlePendingResponse(fileResponse.requestId, true, fileResponse)
            } else {
              handlePendingResponse(fileResponse.requestId, false, null, fileResponse.error)
            }
          } else if (message.type === "change") {
            // File change notification from watcher
            const changeMsg = message as FileChangeMessage
            onFileChangeRef.current?.(changeMsg.action, changeMsg.path, changeMsg.isDirectory)
          }
          break

        case "ports":
          // Check if this is a response to a port kill request
          if ("requestId" in message && message.type === "killResponse") {
            const portResponse = message as PortKillResponse
            handlePendingResponse(portResponse.requestId, portResponse.success, portResponse, portResponse.error)
          } else if (message.type === "change") {
            // Port change notification from watcher
            const changeMsg = message as PortChangeMessage
            onPortChangeRef.current?.(changeMsg.action, changeMsg.port)
          }
          break

        case "error":
          onErrorRef.current?.(message.error)
          break

        default:
          // Legacy agent message (no channel field)
          onAgentMessageRef.current?.(message as unknown as ServerMessage)
      }
    } catch (e) {
      console.error("[useWorkspaceConnection] Failed to parse message:", data, e)
    }
  }, [handlePendingResponse])

  const connect = useCallback(async () => {
    // Increment connection ID to invalidate any pending connections
    const thisConnectionId = ++connectionIdRef.current

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Clear any pending requests
    for (const [, pending] of pendingRequestsRef.current) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Connection reset"))
    }
    pendingRequestsRef.current.clear()

    updateStatus("connecting")
    updateError(null)

    try {
      const wsUrl = api.getWorkspaceUrl(projectId)

      // URL provider that refreshes auth token on each reconnect
      const urlProvider = async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error("Not authenticated")
        }
        const url = new URL(wsUrl)
        url.searchParams.set("token", session.access_token)
        return url.toString()
      }

      const ws = new ReconnectingWebSocket(urlProvider, [], {
        maxRetries: 10,
        connectionTimeout: 10000,
        maxReconnectionDelay: 10000,
      })

      // Check if this connection attempt is still valid
      if (connectionIdRef.current !== thisConnectionId) {
        ws.close()
        return
      }

      ws.onopen = () => {
        if (connectionIdRef.current !== thisConnectionId) return
        updateStatus("connected")
        updateError(null)
      }

      ws.onmessage = (event) => {
        handleMessage(event.data as string, thisConnectionId)
      }

      ws.onerror = (e) => {
        console.error("[useWorkspaceConnection] WebSocket error:", e)
        if (connectionIdRef.current !== thisConnectionId) return
        updateError("Connection error")
        updateStatus("error")
      }

      ws.onclose = () => {
        if (connectionIdRef.current !== thisConnectionId) return
        updateStatus("disconnected")
      }

      wsRef.current = ws
    } catch (err) {
      if (connectionIdRef.current !== thisConnectionId) return
      const errorMessage = err instanceof Error ? err.message : "Failed to connect"
      updateError(errorMessage)
      updateStatus("error")
    }
  }, [projectId, updateStatus, updateError, handleMessage])

  const disconnect = useCallback(() => {
    connectionIdRef.current++

    // Clear any pending requests
    for (const [, pending] of pendingRequestsRef.current) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Disconnected"))
    }
    pendingRequestsRef.current.clear()

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    updateStatus("disconnected")
  }, [updateStatus])

  // =============================================================================
  // Terminal Methods
  // =============================================================================

  const sendTerminalInput = useCallback((data: string) => {
    send({
      channel: "terminal",
      type: "input",
      data,
    } as TerminalInputMessage)
  }, [send])

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    send({
      channel: "terminal",
      type: "resize",
      cols,
      rows,
    } as TerminalResizeMessage)
  }, [send])

  // =============================================================================
  // Agent Methods
  // =============================================================================

  const sendPrompt = useCallback((
    agent: AgentType,
    prompt: string,
    settings: AgentSettings,
    context?: PromptContext,
    history?: unknown[]
  ) => {
    send({
      channel: "agent",
      type: "prompt",
      agent,
      prompt,
      settings,
      context,
      history,
    })
  }, [send])

  const sendAbort = useCallback((agent: AgentType) => {
    send({
      channel: "agent",
      type: "abort",
      agent,
    })
  }, [send])

  const sendApprove = useCallback((agent: AgentType, toolId: string) => {
    send({
      channel: "agent",
      type: "approve",
      agent,
      toolId,
    })
  }, [send])

  const sendReject = useCallback((agent: AgentType, toolId: string) => {
    send({
      channel: "agent",
      type: "reject",
      agent,
      toolId,
    })
  }, [send])

  const sendSettings = useCallback((agent: AgentType, settings: AgentSettings) => {
    send({
      channel: "agent",
      type: "settings",
      agent,
      settings,
    })
  }, [send])

  // =============================================================================
  // File Operations
  // =============================================================================

  const readFile = useCallback(async (path: string): Promise<FileInfo> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileReadResponse>({
      channel: "files",
      type: "read",
      requestId,
      path,
    })

    // Decode base64 content if needed
    let content = response.content
    if (response.encoding === "base64" && !response.isBinary) {
      content = atob(response.content)
    }

    return {
      path: response.path,
      content,
      size: response.size,
      modified: response.modified,
    }
  }, [sendRequest])

  const writeFile = useCallback(async (path: string, content: string): Promise<FileInfo> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileWriteResponse>({
      channel: "files",
      type: "write",
      requestId,
      path,
      content,
      encoding: "utf8",
    })

    return {
      path: response.path,
      content,
      size: response.size,
      modified: response.modified,
    }
  }, [sendRequest])

  const listFiles = useCallback(async (path: string): Promise<DirListing> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileListResponse>({
      channel: "files",
      type: "list",
      requestId,
      path,
    })

    return {
      path: response.path,
      entries: response.entries.map(e => ({
        name: e.name,
        type: e.type,
        size: e.size,
        modified: e.modified,
      })),
    }
  }, [sendRequest])

  const listFilesTree = useCallback(async (): Promise<FileTree> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileListTreeResponse>({
      channel: "files",
      type: "listTree",
      requestId,
    })

    return {
      paths: response.paths,
      directories: response.directories,
    }
  }, [sendRequest])

  const mkdir = useCallback(async (path: string): Promise<{ path: string }> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileMkdirResponse>({
      channel: "files",
      type: "mkdir",
      requestId,
      path,
    })

    return { path: response.path }
  }, [sendRequest])

  const deleteFile = useCallback(async (path: string): Promise<void> => {
    const requestId = crypto.randomUUID()
    await sendRequest<FileDeleteResponse>({
      channel: "files",
      type: "delete",
      requestId,
      path,
    })
  }, [sendRequest])

  const renameFile = useCallback(async (oldPath: string, newPath: string): Promise<{ path: string }> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<FileRenameResponse>({
      channel: "files",
      type: "rename",
      requestId,
      oldPath,
      newPath,
    })

    return { path: response.newPath }
  }, [sendRequest])

  // =============================================================================
  // Port Operations
  // =============================================================================

  const killPort = useCallback(async (port: number): Promise<void> => {
    const requestId = crypto.randomUUID()
    const response = await sendRequest<PortKillResponse>({
      channel: "ports",
      type: "kill",
      requestId,
      port,
    })

    if (!response.success) {
      throw new Error(response.error || "Failed to kill port")
    }
  }, [sendRequest])

  // =============================================================================
  // Cleanup
  // =============================================================================

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    error,
    connect,
    disconnect,
    // Terminal
    sendTerminalInput,
    sendTerminalResize,
    // Agent
    sendPrompt,
    sendAbort,
    sendApprove,
    sendReject,
    sendSettings,
    // File operations
    readFile,
    writeFile,
    listFiles,
    listFilesTree,
    mkdir,
    deleteFile,
    renameFile,
    // Port operations
    killPort,
  }
}
