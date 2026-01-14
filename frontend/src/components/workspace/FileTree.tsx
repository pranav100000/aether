import { useState, useCallback, useMemo } from "react"
import { RefreshCw, FilePlus, FolderPlus } from "lucide-react"
import { api } from "@/lib/api"
import { FileTreeItem } from "./FileTreeItem"
import { Spinner } from "@/components/ui/spinner"
import { useFileTreeContext } from "@/contexts/FileTreeContext"
import { buildTreeFromPaths } from "@/lib/file-tree-utils"

interface FileTreeProps {
  projectId: string
  onFileSelect: (path: string) => void
  selectedPath?: string
}

export function FileTree({ projectId, onFileSelect, selectedPath }: FileTreeProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [createName, setCreateName] = useState("")

  const { allFiles, directories, isLoading, error, refresh, handleFileChange } = useFileTreeContext()

  // Build tree structure from flat paths
  const treeNodes = useMemo(() => {
    return buildTreeFromPaths(allFiles, directories)
  }, [allFiles, directories])

  const handleCreate = useCallback(async () => {
    if (!createName || !creating) {
      setCreating(null)
      return
    }

    try {
      const createPath = "/" + createName
      if (creating === "folder") {
        await api.mkdir(projectId, createPath)
        handleFileChange("create", createPath, true)
      } else {
        await api.writeFile(projectId, createPath, "")
        handleFileChange("create", createPath, false)
      }
    } catch (err) {
      console.error("Failed to create:", err)
      alert("Failed to create: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setCreating(null)
      setCreateName("")
    }
  }, [createName, creating, projectId, handleFileChange])

  if (isLoading) {
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
          onClick={refresh}
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
            onClick={refresh}
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
        {treeNodes.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No files yet
          </div>
        ) : (
          treeNodes.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              projectId={projectId}
              level={0}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
