import { useEffect, useRef, useImperativeHandle, forwardRef } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import "@xterm/xterm/css/xterm.css"

interface TerminalInstanceProps {
  sessionId: string
  projectId: string
  isActive: boolean
  onDisconnect?: () => void
  onFileChange?: (action: string, path: string, isDirectory: boolean) => void
  onPortChange?: (action: "open" | "close", port: number) => void
}

interface WSMessage {
  type: "input" | "output" | "resize" | "error" | "file_change" | "port_change"
  data?: string
  cols?: number
  rows?: number
  action?: string
  path?: string
  is_directory?: boolean
  port?: number
}

export interface TerminalInstanceHandle {
  focus: () => void
}

export const TerminalInstance = forwardRef<TerminalInstanceHandle, TerminalInstanceProps>(
  function TerminalInstance(
    { sessionId, projectId, isActive, onDisconnect, onFileChange, onPortChange },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<XTerm | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const onFileChangeRef = useRef(onFileChange)
    const onPortChangeRef = useRef(onPortChange)
    const isActiveRef = useRef(isActive)

    // Expose focus method via ref
    useImperativeHandle(ref, () => ({
      focus: () => {
        terminalRef.current?.focus()
      },
    }))

    // Keep refs updated
    useEffect(() => {
      onFileChangeRef.current = onFileChange
    }, [onFileChange])

    useEffect(() => {
      onPortChangeRef.current = onPortChange
    }, [onPortChange])

    useEffect(() => {
      isActiveRef.current = isActive
    }, [isActive])

    // Refit terminal when becoming active
    useEffect(() => {
      if (isActive && fitAddonRef.current && terminalRef.current) {
        // Small delay to ensure container has correct dimensions
        const timer = setTimeout(() => {
          fitAddonRef.current?.fit()
          terminalRef.current?.focus()

          // Send resize to backend
          if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
            const message: WSMessage = {
              type: "resize",
              cols: terminalRef.current.cols,
              rows: terminalRef.current.rows,
            }
            wsRef.current.send(JSON.stringify(message))
          }
        }, 50)
        return () => clearTimeout(timer)
      }
    }, [isActive])

    useEffect(() => {
      if (!containerRef.current) return

      let canceled = false

      const terminal = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "JetBrains Mono",
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

          if (canceled) return

          if (!session?.access_token) {
            throw new Error("Not authenticated")
          }

          const wsUrl = api.getTerminalUrl(projectId)
          const ws = new WebSocket(wsUrl, ["bearer", session.access_token])

          if (canceled) {
            ws.close()
            return
          }

          ws.onopen = () => {
            if (canceled) return
            if (isActiveRef.current) {
              terminal.focus()
            }
            const message: WSMessage = {
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }
            ws.send(JSON.stringify(message))
          }

          ws.onmessage = (event) => {
            if (canceled) return
            try {
              const message: WSMessage = JSON.parse(event.data)
              if (message.type === "output" && message.data) {
                terminal.write(message.data)
              } else if (message.type === "error" && message.data) {
                terminal.write(`\r\n\x1b[31mError: ${message.data}\x1b[0m\r\n`)
              } else if (message.type === "file_change" && message.action && message.path) {
                onFileChangeRef.current?.(message.action, message.path, message.is_directory ?? false)
              } else if (message.type === "port_change" && message.action && message.port) {
                onPortChangeRef.current?.(message.action as "open" | "close", message.port)
              }
            } catch {
              terminal.write(event.data)
            }
          }

          ws.onerror = () => {
            // Connection error handled by onclose
          }

          ws.onclose = () => {
            if (canceled) return
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
          if (canceled) return
          terminal.write(
            `\r\n\x1b[31mError: ${err instanceof Error ? err.message : "Failed to connect"}\x1b[0m\r\n`
          )
        }
      }

      connect()

      return () => {
        canceled = true
        window.removeEventListener("resize", handleResize)
        wsRef.current?.close()
        terminal.dispose()
      }
    }, [sessionId, projectId, onDisconnect])

    return (
      <div className="h-full flex flex-col justify-end bg-[#0a0a0a]">
        <div
          ref={containerRef}
          className="flex-1 p-2"
          onClick={() => terminalRef.current?.focus()}
        />
      </div>
    )
  }
)
