import { useEffect, useRef, useState } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import "@xterm/xterm/css/xterm.css"

interface TerminalProps {
  projectId: string
  onDisconnect?: () => void
}

interface WSMessage {
  type: "input" | "output" | "resize" | "error"
  data?: string
  cols?: number
  rows?: number
}

export function Terminal({ projectId, onDisconnect }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#555555",
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    try {
      const webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not supported, fall back to canvas
    }

    terminal.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const handleResize = () => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const message: WSMessage = {
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }
        wsRef.current.send(JSON.stringify(message))
      }
    }

    window.addEventListener("resize", handleResize)

    const connect = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error("Not authenticated")
        }

        const wsUrl = api.getTerminalUrl(projectId)
        const ws = new WebSocket(wsUrl, ["bearer", session.access_token])

        ws.onopen = () => {
          setStatus("connected")
          setError(null)
          terminal.focus()
          const message: WSMessage = {
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }
          ws.send(JSON.stringify(message))
        }

        ws.onmessage = (event) => {
          try {
            const message: WSMessage = JSON.parse(event.data)
            if (message.type === "output" && message.data) {
              terminal.write(message.data)
            } else if (message.type === "error" && message.data) {
              terminal.write(`\r\n\x1b[31mError: ${message.data}\x1b[0m\r\n`)
              setError(message.data)
            }
          } catch {
            terminal.write(event.data)
          }
        }

        ws.onerror = () => {
          setStatus("error")
          setError("Connection error")
        }

        ws.onclose = () => {
          setStatus("disconnected")
          onDisconnect?.()
        }

        wsRef.current = ws

        terminal.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            const message: WSMessage = { type: "input", data }
            ws.send(JSON.stringify(message))
          }
        })
      } catch (err) {
        setStatus("error")
        setError(err instanceof Error ? err.message : "Failed to connect")
      }
    }

    connect()

    return () => {
      window.removeEventListener("resize", handleResize)
      wsRef.current?.close()
      terminal.dispose()
    }
  }, [projectId, onDisconnect])

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-3 py-1 bg-card border-b border-border text-xs">
        <span className="text-muted-foreground">Terminal</span>
        <span
          className={`flex items-center gap-1.5 ${
            status === "connected"
              ? "text-green-400"
              : status === "connecting"
                ? "text-yellow-400"
                : "text-red-400"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
            }`}
          />
          {status === "connecting" && "Connecting..."}
          {status === "connected" && "Connected"}
          {status === "disconnected" && "Disconnected"}
          {status === "error" && (error || "Error")}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 p-2"
        onClick={() => terminalRef.current?.focus()}
      />
    </div>
  )
}
