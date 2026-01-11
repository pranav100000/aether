import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { api } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { basename, isChildOrEqualPath } from "@/lib/path-utils"

interface FileTreeContextValue {
  // All file paths in the project
  allFiles: string[]
  // All directory paths in the project
  directories: string[]
  // Loading state for initial fetch
  isLoading: boolean
  // Error state
  error: string | null
  // Search files by query (fuzzy match on path)
  searchFiles: (query: string, limit?: number) => string[]
  // Handle file change from websocket or UI
  handleFileChange: (action: string, path: string, isDirectory: boolean) => void
  // Refresh the file tree (refetch from server)
  refresh: () => Promise<void>
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null)

export function useFileTreeContext() {
  const context = useContext(FileTreeContext)
  if (!context) {
    throw new Error("useFileTreeContext must be used within a FileTreeProvider")
  }
  return context
}

interface FileTreeProviderProps {
  vmUrl: string
  machineId: string
  children: ReactNode
}

export function FileTreeProvider({ vmUrl, machineId, children }: FileTreeProviderProps) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const tree = await api.listFilesTree(vmUrl, machineId)
      setAllFiles(tree.paths)
      setDirectories(tree.directories)
    } catch (err) {
      console.error("Failed to load file tree:", err)
      setError(err instanceof Error ? err.message : "Failed to load file tree")
    } finally {
      setIsLoading(false)
    }
  }, [vmUrl, machineId])

  // Load file tree on mount
  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  // Subscribe to file events from VM
  const wsRef = useRef<WebSocket | null>(null)
  const handleFileChangeRef = useRef<typeof handleFileChange | null>(null)

  useEffect(() => {
    let cancelled = false

    const connectEvents = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled || !session?.access_token) return

      const wsUrl = vmUrl.replace("https", "wss").replace("http", "ws")
      const ws = new WebSocket(
        `${wsUrl}/events?fly-force-instance-id=${machineId}`,
        ["bearer", session.access_token]
      )

      ws.onopen = () => {
        console.log("[FileTree] Events WebSocket connected")
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === "file_change" && handleFileChangeRef.current) {
            // Determine if it's a directory based on path (no extension = likely directory)
            // We'll do a refresh to get accurate info for creates
            if (msg.action === "create") {
              // For creates, refresh the tree to get accurate file/directory info
              loadFileTree()
            } else {
              handleFileChangeRef.current(msg.action, msg.path, false)
            }
          }
        } catch (err) {
          console.error("[FileTree] Failed to parse events message:", err)
        }
      }

      ws.onerror = (err) => {
        console.error("[FileTree] Events WebSocket error:", err)
      }

      ws.onclose = () => {
        console.log("[FileTree] Events WebSocket closed")
      }

      wsRef.current = ws
    }

    connectEvents()

    return () => {
      cancelled = true
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [vmUrl, machineId, loadFileTree])

  const handleFileChange = useCallback((action: string, path: string, isDirectory: boolean) => {
    // Normalize path to ensure it starts with /
    const normalizedPath = path.startsWith("/") ? path : `/${path}`

    if (action === "create") {
      if (isDirectory) {
        setDirectories(prev => {
          if (prev.includes(normalizedPath)) return prev
          return [...prev, normalizedPath].sort()
        })
      } else {
        setAllFiles(prev => {
          if (prev.includes(normalizedPath)) return prev
          return [...prev, normalizedPath].sort()
        })
      }
    } else if (action === "delete") {
      // Remove from files
      setAllFiles(prev => prev.filter(p => !isChildOrEqualPath(p, normalizedPath)))
      // Remove from directories
      setDirectories(prev => prev.filter(p => !isChildOrEqualPath(p, normalizedPath)))
    }
    // 'modify' doesn't change paths, so we ignore it
  }, [])

  // Keep ref updated for WebSocket callback
  useEffect(() => {
    handleFileChangeRef.current = handleFileChange
  }, [handleFileChange])

  const refresh = useCallback(async () => {
    await loadFileTree()
  }, [loadFileTree])

  const searchFiles = useCallback((query: string, limit: number = 20): string[] => {
    if (!query) {
      return allFiles.slice(0, limit)
    }

    const lowerQuery = query.toLowerCase()

    return allFiles
      .filter(path => {
        const filename = basename(path).toLowerCase()
        const pathLower = path.toLowerCase()
        // Match filename first, then full path
        return filename.includes(lowerQuery) || pathLower.includes(lowerQuery)
      })
      .sort((a, b) => {
        // Prioritize exact filename matches
        const aName = basename(a).toLowerCase()
        const bName = basename(b).toLowerCase()
        const aExact = aName === lowerQuery
        const bExact = bName === lowerQuery
        if (aExact !== bExact) return aExact ? -1 : 1
        // Then by path length (shorter = more relevant)
        return a.length - b.length
      })
      .slice(0, limit)
  }, [allFiles])

  return (
    <FileTreeContext.Provider
      value={{
        allFiles,
        directories,
        isLoading,
        error,
        searchFiles,
        handleFileChange,
        refresh,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  )
}
