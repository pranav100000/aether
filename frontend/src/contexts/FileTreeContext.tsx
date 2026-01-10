import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { api, type FileEntry } from "@/lib/api"

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
  "lost+found",
])

interface FileTreeContextValue {
  // All known file paths (cached as user navigates)
  allFiles: string[]

  // Add files to cache when directory is expanded
  addFiles: (parentPath: string, entries: FileEntry[]) => void

  // Search files by query (fuzzy match on path)
  searchFiles: (query: string, limit?: number) => string[]

  // Recursively load a directory (for initial @files search)
  preloadDirectory: (path: string, depth?: number) => Promise<void>

  // Check if preloading is in progress
  isPreloading: boolean
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
  const [isPreloading, setIsPreloading] = useState(false)
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set())

  const addFiles = useCallback((parentPath: string, entries: FileEntry[]) => {
    const newFiles: string[] = []

    for (const entry of entries) {
      if (HIDDEN_ENTRIES.has(entry.name)) continue

      const fullPath = parentPath === "/" ? `/${entry.name}` : `${parentPath}/${entry.name}`

      if (entry.type === "file") {
        newFiles.push(fullPath)
      }
    }

    if (newFiles.length > 0) {
      setAllFiles(prev => {
        const existing = new Set(prev)
        const toAdd = newFiles.filter(f => !existing.has(f))
        if (toAdd.length === 0) return prev
        return [...prev, ...toAdd]
      })
    }

    setLoadedDirs(prev => new Set([...prev, parentPath]))
  }, [])

  const preloadDirectory = useCallback(async (path: string, depth: number = 2) => {
    if (depth <= 0) return
    if (loadedDirs.has(path)) return

    setIsPreloading(true)

    try {
      const listing = await api.listFiles(projectId, path)
      const entries = listing.entries.filter(e => !HIDDEN_ENTRIES.has(e.name))

      addFiles(path, entries)

      // Recursively load subdirectories
      const subdirs = entries.filter(e => e.type === "directory")
      await Promise.all(
        subdirs.map(dir => {
          const subPath = path === "/" ? `/${dir.name}` : `${path}/${dir.name}`
          return preloadDirectory(subPath, depth - 1)
        })
      )
    } catch (err) {
      console.error("Failed to preload directory:", path, err)
    } finally {
      setIsPreloading(false)
    }
  }, [projectId, loadedDirs, addFiles])

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
        addFiles,
        searchFiles,
        preloadDirectory,
        isPreloading,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  )
}
