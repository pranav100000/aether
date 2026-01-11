import { useState, useCallback, useMemo } from "react"
import { RefreshCw, FilePlus, FolderPlus } from "lucide-react"
import { api } from "@/lib/api"
import { FileTreeItem, type TreeNode } from "./FileTreeItem"
import { Spinner } from "@/components/ui/spinner"
import { useFileTreeContext } from "@/contexts/FileTreeContext"

interface FileTreeProps {
  projectId: string
  onFileSelect: (path: string) => void
  selectedPath?: string
}

// Build tree structure from flat paths
function buildTreeFromPaths(files: string[], directories: string[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()

  // Add all directories first
  for (const dir of directories) {
    nodeMap.set(dir, {
      name: dir.split("/").pop() || "",
      path: dir,
      type: "directory",
      children: [],
    })
  }

  // Add all files
  for (const file of files) {
    nodeMap.set(file, {
      name: file.split("/").pop() || "",
      path: file,
      type: "file",
    })
  }

  // Build parent-child relationships
  const rootNodes: TreeNode[] = []

  for (const [path, node] of nodeMap) {
    const parentPath = path.substring(0, path.lastIndexOf("/")) || ""

    if (parentPath === "" || parentPath === "/") {
      // Root level item
      rootNodes.push(node)
    } else {
      // Find parent and add as child
      const parent = nodeMap.get(parentPath)
      if (parent && parent.children) {
        parent.children.push(node)
      } else {
        // Parent doesn't exist (shouldn't happen with proper data), add to root
        rootNodes.push(node)
      }
    }
  }

  // Sort: directories first, then alphabetically
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  // Sort root and all children recursively
  const sortRecursive = (nodes: TreeNode[]): TreeNode[] => {
    const sorted = sortNodes(nodes)
    for (const node of sorted) {
      if (node.children) {
        node.children = sortRecursive(node.children)
      }
    }
    return sorted
  }

  return sortRecursive(rootNodes)
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
