import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import type { Project } from "@/lib/api"

interface UseProjectReturn {
  project: Project | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function useProject(projectId: string): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await api.getProject(projectId)
      setProject(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const start = useCallback(async () => {
    setProject((prev) => (prev ? { ...prev, status: "starting" } : null))
    try {
      await api.startProject(projectId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start project")
      await refresh()
    }
  }, [projectId, refresh])

  const stop = useCallback(async () => {
    setProject((prev) => (prev ? { ...prev, status: "stopping" } : null))
    try {
      await api.stopProject(projectId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop project")
      await refresh()
    }
  }, [projectId, refresh])

  return {
    project,
    loading,
    error,
    refresh,
    start,
    stop,
  }
}
