import { useState, useEffect, useCallback } from "react"
import { RefreshCw, FilePlus, FolderPlus } from "lucide-react"
import { api } from "@/lib/api"
import type { FileEntry } from "@/lib/api"
import { FileTreeItem } from "./FileTreeItem"
import { Spinner } from "@/components/ui/spinner"
import { useFileTreeContext } from "@/contexts/FileTreeContext"

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

interface FileTreeProps {
  projectId: string
  onFileSelect: (path: string) => void
  selectedPath?: string
  refreshTrigger?: number
}

export function FileTree({ projectId, onFileSelect, selectedPath, refreshTrigger }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [createName, setCreateName] = useState("")

  // Get addFiles from context to populate file cache for @mentions
  const { addFiles } = useFileTreeContext()

  const filterAndSortEntries = (entries: FileEntry[]): FileEntry[] => {
    return entries
      .filter((e) => !HIDDEN_ENTRIES.has(e.name))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
  }

  const loadRoot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const listing = await api.listFiles(projectId, "/")
      setEntries(filterAndSortEntries(listing.entries))
      // Add files to context cache for @mentions
      addFiles("/", listing.entries)
    } catch (err) {
      console.error("Failed to load file tree:", err)
      setError(err instanceof Error ? err.message : "Failed to load files")
    } finally {
      setLoading(false)
    }
  }, [projectId, addFiles])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  // Refresh when refreshTrigger changes (from file watcher)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      loadRoot()
    }
  }, [refreshTrigger, loadRoot])

  const handleCreate = useCallback(async () => {
    if (!createName || !creating) {
      setCreating(null)
      return
    }

    try {
      const createPath = "/" + createName
      if (creating === "folder") {
        await api.mkdir(projectId, createPath)
      } else {
        await api.writeFile(projectId, createPath, "")
      }
      await loadRoot()
    } catch (err) {
      console.error("Failed to create:", err)
      alert("Failed to create: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setCreating(null)
      setCreateName("")
    }
  }, [createName, creating, projectId, loadRoot])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive text-sm mb-2">{error}</p>
        <button
          onClick={loadRoot}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={() => setCreating("file")}
            title="New File"
          >
            <FilePlus className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={() => setCreating("folder")}
            title="New Folder"
          >
            <FolderPlus className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={loadRoot}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Create input at root level */}
      {creating && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
          <div className="w-4" />
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onBlur={handleCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate()
              if (e.key === "Escape") {
                setCreating(null)
                setCreateName("")
              }
            }}
            placeholder={creating === "folder" ? "folder name" : "file name"}
            className="flex-1 bg-input text-sm px-1 py-0 outline-none"
            autoFocus
          />
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No files yet
          </div>
        ) : (
          entries.map((entry) => (
            <FileTreeItem
              key={entry.name}
              entry={entry}
              path="/"
              projectId={projectId}
              level={0}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onRefresh={loadRoot}
            />
          ))
        )}
      </div>
    </div>
  )
}
