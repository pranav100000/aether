import { useState, useCallback } from "react"
import { api } from "@/lib/api"
import type { FileEntry } from "@/lib/api"

// Files/folders to hide in the file tree
const HIDDEN_ENTRIES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
  "dist",
  "build",
  ".next",
  ".cache",
  ".DS_Store",
  "Thumbs.db",
])

interface UseFilesReturn {
  entries: FileEntry[]
  loading: boolean
  error: string | null
  currentPath: string
  navigate: (path: string) => Promise<void>
  refresh: () => Promise<void>
  createFile: (name: string, content?: string) => Promise<void>
  createFolder: (name: string) => Promise<void>
  deleteEntry: (name: string) => Promise<void>
  renameEntry: (oldName: string, newName: string) => Promise<void>
}

export function useFiles(projectId: string): UseFilesReturn {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState("/")

  const filterEntries = (items: FileEntry[]): FileEntry[] => {
    return items.filter((entry) => !HIDDEN_ENTRIES.has(entry.name))
  }

  const sortEntries = (items: FileEntry[]): FileEntry[] => {
    return [...items].sort((a, b) => {
      // Directories first
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      // Then alphabetically
      return a.name.localeCompare(b.name)
    })
  }

  const navigate = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const listing = await api.listFiles(projectId, path)
        setEntries(sortEntries(filterEntries(listing.entries)))
        setCurrentPath(path)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load files")
      } finally {
        setLoading(false)
      }
    },
    [projectId]
  )

  const refresh = useCallback(async () => {
    await navigate(currentPath)
  }, [navigate, currentPath])

  const createFile = useCallback(
    async (name: string, content: string = "") => {
      setError(null)
      try {
        const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`
        await api.writeFile(projectId, path, content)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create file")
        throw err
      }
    },
    [projectId, currentPath, refresh]
  )

  const createFolder = useCallback(
    async (name: string) => {
      setError(null)
      try {
        const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`
        await api.mkdir(projectId, path)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create folder")
        throw err
      }
    },
    [projectId, currentPath, refresh]
  )

  const deleteEntry = useCallback(
    async (name: string) => {
      setError(null)
      try {
        const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`
        await api.deleteFile(projectId, path)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete")
        throw err
      }
    },
    [projectId, currentPath, refresh]
  )

  const renameEntry = useCallback(
    async (oldName: string, newName: string) => {
      setError(null)
      try {
        const oldPath =
          currentPath === "/" ? `/${oldName}` : `${currentPath}/${oldName}`
        const newPath =
          currentPath === "/" ? `/${newName}` : `${currentPath}/${newName}`
        await api.renameFile(projectId, oldPath, newPath)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename")
        throw err
      }
    },
    [projectId, currentPath, refresh]
  )

  return {
    entries,
    loading,
    error,
    currentPath,
    navigate,
    refresh,
    createFile,
    createFolder,
    deleteEntry,
    renameEntry,
  }
}
