import { useState, useCallback, useRef } from "react"

export interface TerminalSession {
  id: string
  name: string
  createdAt: number
}

interface UseTerminalSessionsReturn {
  sessions: TerminalSession[]
  activeSessionId: string | null
  createSession: () => TerminalSession
  closeSession: (id: string) => void
  setActiveSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  nextSession: () => void
  previousSession: () => void
}

function generateId(): string {
  return crypto.randomUUID()
}

export function useTerminalSessions(): UseTerminalSessionsReturn {
  const counterRef = useRef(2) // Start at 2 since first terminal is "Terminal 1"
  const [sessions, setSessions] = useState<TerminalSession[]>(() => {
    const initial: TerminalSession = {
      id: generateId(),
      name: "Terminal 1",
      createdAt: Date.now(),
    }
    return [initial]
  })
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => sessions[0]?.id ?? null
  )

  const createSession = useCallback((): TerminalSession => {
    const newSession: TerminalSession = {
      id: generateId(),
      name: `Terminal ${counterRef.current++}`,
      createdAt: Date.now(),
    }
    setSessions((prev) => [...prev, newSession])
    setActiveSessionId(newSession.id)
    return newSession
  }, [])

  const closeSession = useCallback(
    (id: string) => {
      // Prevent closing the last session
      if (sessions.length <= 1) {
        return
      }

      const index = sessions.findIndex((s) => s.id === id)
      setSessions((prev) => prev.filter((s) => s.id !== id))

      // If closing the active session, switch to another
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        // Prefer the session to the left, or the first one if we're at index 0
        const newIndex = Math.max(0, index - 1)
        setActiveSessionId(remaining[newIndex]?.id ?? null)
      }
    },
    [sessions, activeSessionId]
  )

  const setActiveSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    )
  }, [])

  const nextSession = useCallback(() => {
    if (sessions.length <= 1) return
    const currentIndex = sessions.findIndex((s) => s.id === activeSessionId)
    const nextIndex = (currentIndex + 1) % sessions.length
    setActiveSessionId(sessions[nextIndex].id)
  }, [sessions, activeSessionId])

  const previousSession = useCallback(() => {
    if (sessions.length <= 1) return
    const currentIndex = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIndex = (currentIndex - 1 + sessions.length) % sessions.length
    setActiveSessionId(sessions[prevIndex].id)
  }, [sessions, activeSessionId])

  return {
    sessions,
    activeSessionId,
    createSession,
    closeSession,
    setActiveSession,
    renameSession,
    nextSession,
    previousSession,
  }
}
