import { useState, useRef, useCallback, useEffect } from "react"
import ReconnectingWebSocket from "reconnecting-websocket"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import type {
  AgentType,
  ServerMessage,
  AgentSettings,
  PromptContext,
} from "@/types/agent"

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

// Terminal channel messages
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

// File change message
interface FileChangeMessage {
  channel: "files"
  type: "change"
  action: "create" | "modify" | "delete"
  path: string
  isDirectory: boolean
}

// Port change message
interface PortChangeMessage {
  channel: "ports"
  type: "change"
  action: "open" | "close"
  port: number
}

// Agent channel messages (include channel field)
interface AgentChannelMessage extends ServerMessage {
  channel: "agent"
  agent?: AgentType
}

// Error message
interface ErrorMessage {
  channel: "error"
  type: "error"
  error: string
}

// Union of all incoming messages
type IncomingMessage =
  | TerminalOutputMessage
  | FileChangeMessage
  | PortChangeMessage
  | AgentChannelMessage
  | ErrorMessage

export interface UseWorkspaceConnectionOptions {
  projectId: string
  onTerminalOutput?: (data: string) => void
  onAgentMessage?: (message: ServerMessage) => void
  onFileChange?: (action: "create" | "modify" | "delete", path: string, isDirectory: boolean) => void
  onPortChange?: (action: "open" | "close", port: number) => void
  onError?: (error: string) => void
  onStatusChange?: (status: ConnectionStatus) => void
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

  const handleMessage = useCallback((data: string, connectionId: number) => {
    if (connectionIdRef.current !== connectionId) return

    try {
      const message = JSON.parse(data) as IncomingMessage

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
          if (message.type === "change") {
            onFileChangeRef.current?.(message.action, message.path, message.isDirectory)
          }
          break

        case "ports":
          if (message.type === "change") {
            onPortChangeRef.current?.(message.action, message.port)
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
  }, [])

  const connect = useCallback(async () => {
    // Increment connection ID to invalidate any pending connections
    const thisConnectionId = ++connectionIdRef.current

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

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
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    updateStatus("disconnected")
  }, [updateStatus])

  // Terminal methods
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

  // Agent methods
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

  // Note: We don't auto-connect on mount since the workspace might not be ready
  // The component using this hook should call connect() when appropriate

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
    sendTerminalInput,
    sendTerminalResize,
    sendPrompt,
    sendAbort,
    sendApprove,
    sendReject,
    sendSettings,
  }
}
