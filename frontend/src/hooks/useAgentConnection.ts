import { useState, useRef, useCallback, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import type {
  AgentType,
  ServerMessage,
  ClientMessage,
  AgentSettings,
  PromptContext,
} from "@/types/agent"

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

export interface UseAgentConnectionOptions {
  projectId: string
  agent: AgentType
  onMessage: (message: ServerMessage) => void
  onError?: (error: string) => void
  onStatusChange?: (status: ConnectionStatus) => void
}

export interface UseAgentConnectionReturn {
  status: ConnectionStatus
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  sendPrompt: (prompt: string, settings: AgentSettings, context?: PromptContext) => void
  sendAbort: () => void
  sendApprove: (toolId: string) => void
  sendReject: (toolId: string) => void
  sendSettings: (settings: AgentSettings) => void
}

export function useAgentConnection({
  projectId,
  agent,
  onMessage,
  onError,
  onStatusChange,
}: UseAgentConnectionOptions): UseAgentConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected")
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const connectionIdRef = useRef(0)

  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus)
    onStatusChange?.(newStatus)
  }, [onStatusChange])

  const updateError = useCallback((err: string | null) => {
    setError(err)
    if (err) {
      onError?.(err)
    }
  }, [onError])

  const send = useCallback((message: ClientMessage) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[useAgentConnection] Cannot send - WebSocket not open")
      return false
    }
    wsRef.current.send(JSON.stringify(message))
    return true
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
      const wsUrl = api.getAgentUrl(projectId, agent)
      const isLocalMode = !!import.meta.env.VITE_LOCAL_AGENT_URL

      let ws: WebSocket

      if (isLocalMode) {
        // Local dev mode: no authentication needed
        ws = new WebSocket(wsUrl)
      } else {
        // Production mode: authenticate via Supabase
        const { data: { session } } = await supabase.auth.getSession()

        // Check if this connection attempt is still valid
        if (connectionIdRef.current !== thisConnectionId) return

        if (!session?.access_token) {
          throw new Error("Not authenticated")
        }

        ws = new WebSocket(wsUrl, ["bearer", session.access_token])
      }

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
        if (connectionIdRef.current !== thisConnectionId) return
        try {
          const message: ServerMessage = JSON.parse(event.data)
          onMessage(message)
        } catch (e) {
          console.error("[useAgentConnection] Failed to parse message:", event.data, e)
        }
      }

      ws.onerror = (e) => {
        console.error("[useAgentConnection] WebSocket error:", e)
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
  }, [projectId, agent, onMessage, updateStatus, updateError])

  const disconnect = useCallback(() => {
    connectionIdRef.current++
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    updateStatus("disconnected")
  }, [updateStatus])

  const sendPrompt = useCallback((
    prompt: string,
    settings: AgentSettings,
    context?: PromptContext
  ) => {
    send({
      type: "prompt",
      prompt,
      settings,
      context,
    })
  }, [send])

  const sendAbort = useCallback(() => {
    send({ type: "abort" })
  }, [send])

  const sendApprove = useCallback((toolId: string) => {
    send({ type: "approve", toolId })
  }, [send])

  const sendReject = useCallback((toolId: string) => {
    send({ type: "reject", toolId })
  }, [send])

  const sendSettings = useCallback((settings: AgentSettings) => {
    send({ type: "settings", settings })
  }, [send])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    status,
    error,
    connect,
    disconnect,
    sendPrompt,
    sendAbort,
    sendApprove,
    sendReject,
    sendSettings,
  }
}
