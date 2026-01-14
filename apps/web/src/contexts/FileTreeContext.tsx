import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { api } from "@/lib/api"
import { basename, isChildOrEqualPath } from "@/lib/path-utils"
import type { FileOperationsProvider } from "@/hooks/useWorkspaceConnection"

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
  projectId: string
  children: ReactNode
  /** Optional WebSocket file operations provider - uses REST API if not provided */
  fileOps?: FileOperationsProvider
  /** Callback to receive the handleFileChange function for external file change notifications */
  onHandleFileChangeReady?: (handler: (action: string, path: string, isDirectory: boolean) => void) => void
}

export function FileTreeProvider({ projectId, children, fileOps, onHandleFileChangeReady }: FileTreeProviderProps) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Use WebSocket file operations if available, otherwise fall back to REST API
      const tree = fileOps
        ? await fileOps.listFilesTree()
        : await api.listFilesTree(projectId)
      setAllFiles(tree.paths)
      setDirectories(tree.directories)
    } catch (err) {
      console.error("Failed to load file tree:", err)
      setError(err instanceof Error ? err.message : "Failed to load file tree")
    } finally {
      setIsLoading(false)
    }
  }, [projectId, fileOps])

  // Load file tree on mount
  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const handleFileChange = useCallback((action: string, path: string, isDirectory: boolean) => {
    // Normalize path to ensure it starts with /
    const normalizedPath = path.startsWith("/") ? path : `/${path}`

    if (action === "create" || action === "modify") {
      // Treat modify as create if file doesn't exist (fs.watch can't distinguish)
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
  }, [])

  // Notify parent component that handleFileChange is ready
  useEffect(() => {
    if (onHandleFileChangeReady) {
      onHandleFileChangeReady(handleFileChange)
    }
  }, [onHandleFileChangeReady, handleFileChange])

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
