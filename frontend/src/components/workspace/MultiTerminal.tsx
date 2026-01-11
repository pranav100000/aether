import { useEffect, useRef, useCallback } from "react"
import { useTerminalSessions } from "@/hooks/useTerminalSessions"
import { TerminalTabs } from "./TerminalTabs"
import { TerminalInstance, type TerminalInstanceHandle } from "./TerminalInstance"
import { useFileTreeContext } from "@/contexts/FileTreeContext"

interface MultiTerminalProps {
  projectId: string
  onDisconnect?: () => void
  onPortChange?: (action: "open" | "close", port: number) => void
}

export function MultiTerminal({
  projectId,
  onDisconnect,
  onPortChange,
}: MultiTerminalProps) {
  // Get handleFileChange from context for websocket file_change events
  const { handleFileChange } = useFileTreeContext()
  const {
    sessions,
    activeSessionId,
    createSession,
    closeSession,
    setActiveSession,
    nextSession,
    previousSession,
  } = useTerminalSessions()

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRefs = useRef<Map<string, TerminalInstanceHandle>>(new Map())

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
      const modifier = isMac ? e.metaKey : e.ctrlKey

      if (modifier && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault()
        createSession()
      } else if (modifier && e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault()
        if (activeSessionId && sessions.length > 1) {
          closeSession(activeSessionId)
        }
      } else if (modifier && !e.shiftKey && e.key === "Tab") {
        e.preventDefault()
        nextSession()
      } else if (modifier && e.shiftKey && e.key === "Tab") {
        e.preventDefault()
        previousSession()
      }
    },
    [activeSessionId, sessions.length, createSession, closeSession, nextSession, previousSession]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener("keydown", handleKeyDown)
    return () => container.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Focus active terminal when session changes
  useEffect(() => {
    if (activeSessionId) {
      const terminalHandle = terminalRefs.current.get(activeSessionId)
      terminalHandle?.focus()
    }
  }, [activeSessionId])

  const setTerminalRef = useCallback(
    (id: string) => (handle: TerminalInstanceHandle | null) => {
      if (handle) {
        terminalRefs.current.set(id, handle)
      } else {
        terminalRefs.current.delete(id)
      }
    },
    []
  )

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-[#0a0a0a]" tabIndex={-1}>
      <TerminalTabs
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSession}
        onClose={closeSession}
        onCreate={createSession}
      />
      <div className="flex-1 relative overflow-hidden">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{ display: session.id === activeSessionId ? "block" : "none" }}
          >
            <TerminalInstance
              ref={setTerminalRef(session.id)}
              sessionId={session.id}
              projectId={projectId}
              isActive={session.id === activeSessionId}
              onDisconnect={onDisconnect}
              onFileChange={handleFileChange}
              onPortChange={onPortChange}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
