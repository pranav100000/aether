import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, MoreVertical, Trash2, Pencil, FilePlus, FolderPlus } from "lucide-react"
import { api } from "@/lib/api"
import type { FileEntry } from "@/lib/api"
import { cn } from "@/lib/utils"
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

interface FileTreeItemProps {
  entry: FileEntry
  path: string
  projectId: string
  level: number
  selectedPath?: string
  onFileSelect: (path: string) => void
  onRefresh: () => void
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase()

  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "text-yellow-400"
    case "jsx":
      return "text-cyan-400"
    case "ts":
    case "mts":
    case "cts":
      return "text-blue-400"
    case "tsx":
      return "text-blue-500"
    case "py":
      return "text-green-400"
    case "go":
      return "text-cyan-300"
    case "html":
    case "htm":
      return "text-orange-400"
    case "css":
    case "scss":
    case "less":
      return "text-purple-400"
    case "json":
      return "text-yellow-300"
    case "md":
    case "markdown":
      return "text-gray-400"
    case "yaml":
    case "yml":
      return "text-pink-400"
    default:
      return "text-gray-400"
  }
}

export function FileTreeItem({
  entry,
  path,
  projectId,
  level,
  selectedPath,
  onFileSelect,
  onRefresh,
}: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(entry.name)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [createName, setCreateName] = useState("")

  // Get addFiles from context to populate file cache for @mentions
  const { addFiles } = useFileTreeContext()

  const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`
  const isSelected = selectedPath === fullPath
  const isDirectory = entry.type === "directory"

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

  const handleExpand = useCallback(async () => {
    if (!isDirectory) return

    if (!expanded && children === null) {
      setLoading(true)
      try {
        const listing = await api.listFiles(projectId, fullPath)
        setChildren(filterAndSortEntries(listing.entries))
        // Add files to context cache for @mentions
        addFiles(fullPath, listing.entries)
      } catch (err) {
        console.error("Failed to load directory:", err)
      } finally {
        setLoading(false)
      }
    }

    setExpanded(!expanded)
  }, [expanded, children, isDirectory, projectId, fullPath, addFiles])

  const handleClick = useCallback(() => {
    if (isDirectory) {
      handleExpand()
    } else {
      onFileSelect(fullPath)
    }
  }, [isDirectory, handleExpand, onFileSelect, fullPath])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [])

  const handleDelete = useCallback(async () => {
    setShowContextMenu(false)
    if (!confirm(`Delete "${entry.name}"?`)) return

    try {
      await api.deleteFile(projectId, fullPath)
      onRefresh()
    } catch (err) {
      console.error("Failed to delete:", err)
      alert("Failed to delete: " + (err instanceof Error ? err.message : "Unknown error"))
    }
  }, [projectId, fullPath, entry.name, onRefresh])

  const handleRename = useCallback(async () => {
    if (!newName || newName === entry.name) {
      setRenaming(false)
      return
    }

    try {
      const newPath = path === "/" ? `/${newName}` : `${path}/${newName}`
      await api.renameFile(projectId, fullPath, newPath)
      onRefresh()
    } catch (err) {
      console.error("Failed to rename:", err)
      alert("Failed to rename: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setRenaming(false)
    }
  }, [newName, entry.name, projectId, fullPath, path, onRefresh])

  const handleCreate = useCallback(async () => {
    if (!createName || !creating) {
      setCreating(null)
      return
    }

    try {
      const createPath = fullPath + "/" + createName
      if (creating === "folder") {
        await api.mkdir(projectId, createPath)
      } else {
        await api.writeFile(projectId, createPath, "")
      }
      // Refresh the children
      const listing = await api.listFiles(projectId, fullPath)
      setChildren(filterAndSortEntries(listing.entries))
      // Add files to context cache for @mentions
      addFiles(fullPath, listing.entries)
      setExpanded(true)
    } catch (err) {
      console.error("Failed to create:", err)
      alert("Failed to create: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setCreating(null)
      setCreateName("")
    }
  }, [createName, creating, projectId, fullPath, addFiles])

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 cursor-pointer group hover:bg-muted/50",
          isSelected && "bg-muted"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {isDirectory ? (
          <>
            {loading ? (
              <div className="w-4 h-4 animate-spin border border-muted-foreground border-t-transparent rounded-full" />
            ) : expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            {expanded ? (
              <FolderOpen className="w-4 h-4 text-yellow-500" />
            ) : (
              <Folder className="w-4 h-4 text-yellow-500" />
            )}
          </>
        ) : (
          <>
            <div className="w-4" />
            <File className={cn("w-4 h-4", getFileIcon(entry.name))} />
          </>
        )}

        {renaming ? (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename()
              if (e.key === "Escape") {
                setRenaming(false)
                setNewName(entry.name)
              }
            }}
            className="flex-1 bg-input text-sm px-1 py-0 outline-none"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm truncate flex-1">{entry.name}</span>
        )}

        <button
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation()
            handleContextMenu(e)
          }}
        >
          <MoreVertical className="w-3 h-3" />
        </button>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowContextMenu(false)}
          />
          <div
            className="fixed z-50 bg-card border border-border rounded shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            {isDirectory && (
              <>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
                  onClick={() => {
                    setShowContextMenu(false)
                    setCreating("file")
                  }}
                >
                  <FilePlus className="w-4 h-4" />
                  New File
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
                  onClick={() => {
                    setShowContextMenu(false)
                    setCreating("folder")
                  }}
                >
                  <FolderPlus className="w-4 h-4" />
                  New Folder
                </button>
                <div className="border-t border-border my-1" />
              </>
            )}
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
              onClick={() => {
                setShowContextMenu(false)
                setRenaming(true)
              }}
            >
              <Pencil className="w-4 h-4" />
              Rename
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}

      {/* Create input */}
      {creating && (
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
        >
          <div className="w-4" />
          {creating === "folder" ? (
            <Folder className="w-4 h-4 text-yellow-500" />
          ) : (
            <File className="w-4 h-4 text-gray-400" />
          )}
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

      {/* Children */}
      {expanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeItem
              key={child.name}
              entry={child}
              path={fullPath}
              projectId={projectId}
              level={level + 1}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}
