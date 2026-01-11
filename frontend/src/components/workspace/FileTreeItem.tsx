import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, Folder, FolderOpen, MoreVertical, Trash2, Pencil, FilePlus, FolderPlus } from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useFileTreeContext } from "@/contexts/FileTreeContext"
import { FileIcon } from "@/components/icons/FileIcon"
import { dirname, join } from "@/lib/path-utils"

export interface TreeNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: TreeNode[]
}

interface FileTreeItemProps {
  node: TreeNode
  projectId: string
  level: number
  selectedPath?: string
  onFileSelect: (path: string) => void
}

export function FileTreeItem({
  node,
  projectId,
  level,
  selectedPath,
  onFileSelect,
}: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(node.name)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [createName, setCreateName] = useState("")

  const { handleFileChange } = useFileTreeContext()

  const isSelected = selectedPath === node.path
  const isDirectory = node.type === "directory"

  const handleExpand = useCallback(() => {
    if (!isDirectory) return
    setExpanded(!expanded)
  }, [expanded, isDirectory])

  const handleClick = useCallback(() => {
    if (isDirectory) {
      handleExpand()
    } else {
      onFileSelect(node.path)
    }
  }, [isDirectory, handleExpand, onFileSelect, node.path])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [])

  const handleDelete = useCallback(async () => {
    setShowContextMenu(false)
    if (!confirm(`Delete "${node.name}"?`)) return

    try {
      await api.deleteFile(projectId, node.path)
      handleFileChange("delete", node.path, isDirectory)
    } catch (err) {
      console.error("Failed to delete:", err)
      alert("Failed to delete: " + (err instanceof Error ? err.message : "Unknown error"))
    }
  }, [projectId, node.path, node.name, isDirectory, handleFileChange])

  const handleRename = useCallback(async () => {
    if (!newName || newName === node.name) {
      setRenaming(false)
      return
    }

    try {
      const parentPath = dirname(node.path)
      const newPath = join(parentPath, newName)
      await api.renameFile(projectId, node.path, newPath)
      // Delete old path and add new path
      handleFileChange("delete", node.path, isDirectory)
      handleFileChange("create", newPath, isDirectory)
    } catch (err) {
      console.error("Failed to rename:", err)
      alert("Failed to rename: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setRenaming(false)
    }
  }, [newName, node.name, projectId, node.path, isDirectory, handleFileChange])

  const handleCreate = useCallback(async () => {
    if (!createName || !creating) {
      setCreating(null)
      return
    }

    try {
      const createPath = join(node.path, createName)
      const creatingDirectory = creating === "folder"
      if (creatingDirectory) {
        await api.mkdir(projectId, createPath)
      } else {
        await api.writeFile(projectId, createPath, "")
      }
      handleFileChange("create", createPath, creatingDirectory)
      setExpanded(true)
    } catch (err) {
      console.error("Failed to create:", err)
      alert("Failed to create: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setCreating(null)
      setCreateName("")
    }
  }, [createName, creating, projectId, node.path, handleFileChange])

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
            {expanded ? (
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
            <FileIcon path={node.name} size="md" />
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
                setNewName(node.name)
              }
            }}
            className="flex-1 bg-input text-sm px-1 py-0 outline-none"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm truncate flex-1">{node.name}</span>
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
            <FileIcon path={createName || "file"} size="md" />
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

      {/* Children - no loading needed, they're already computed */}
      {expanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              projectId={projectId}
              level={level + 1}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
