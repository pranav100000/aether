import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { api } from "@/lib/api"

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
}

export function FileTreeProvider({ projectId, children }: FileTreeProviderProps) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const tree = await api.listFilesTree(projectId)
      setAllFiles(tree.paths)
      setDirectories(tree.directories)
    } catch (err) {
      console.error("Failed to load file tree:", err)
      setError(err instanceof Error ? err.message : "Failed to load file tree")
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  // Load file tree on mount
  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

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
      setAllFiles(prev => prev.filter(p => p !== normalizedPath && !p.startsWith(normalizedPath + "/")))
      // Remove from directories
      setDirectories(prev => prev.filter(p => p !== normalizedPath && !p.startsWith(normalizedPath + "/")))
    }
    // 'modify' doesn't change paths, so we ignore it
  }, [])

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
        const filename = path.split("/").pop()?.toLowerCase() ?? ""
        const pathLower = path.toLowerCase()
        // Match filename first, then full path
        return filename.includes(lowerQuery) || pathLower.includes(lowerQuery)
      })
      .sort((a, b) => {
        // Prioritize exact filename matches
        const aName = a.split("/").pop()?.toLowerCase() ?? ""
        const bName = b.split("/").pop()?.toLowerCase() ?? ""
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
