"use client"

import { useState } from "react"
import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTreeFromFilePaths, type TreeNode } from "@/lib/file-tree-utils"
import { FileIcon } from "@/components/icons/FileIcon"

interface FileTreeViewProps {
  files: string[]
  maxVisible?: number
  className?: string
}

/**
 * Read-only tree view for displaying file paths in tool results.
 * Automatically builds tree structure from flat file paths.
 */
export function FileTreeView({ files, maxVisible = 100, className }: FileTreeViewProps) {
  const visibleFiles = files.slice(0, maxVisible)
  const remaining = files.length - maxVisible

  const treeNodes = buildTreeFromFilePaths(visibleFiles)

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden", className)}>
      <div className="max-h-60 overflow-auto">
        {treeNodes.map((node) => (
          <TreeNodeItem key={node.path} node={node} level={0} />
        ))}
      </div>
      {remaining > 0 && (
        <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-800 bg-zinc-900/80">
          +{remaining} more files
        </div>
      )}
    </div>
  )
}

interface TreeNodeItemProps {
  node: TreeNode
  level: number
}

function TreeNodeItem({ node, level }: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(true)
  const isDirectory = node.type === "directory"

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-sm hover:bg-zinc-800/30 transition-colors",
          isDirectory && "cursor-pointer"
        )}
        style={{ paddingLeft: `${level * 12 + 12}px` }}
        onClick={() => isDirectory && setExpanded(!expanded)}
      >
        {isDirectory ? (
          <>
            <ChevronRightIcon
              className={cn(
                "size-3.5 text-zinc-500 transition-transform",
                expanded && "rotate-90"
              )}
            />
            {expanded ? (
              <FolderOpenIcon className="size-3.5 text-blue-400 flex-shrink-0" />
            ) : (
              <FolderIcon className="size-3.5 text-blue-400 flex-shrink-0" />
            )}
            <span className="font-mono text-zinc-300">{node.name}</span>
          </>
        ) : (
          <>
            <div className="w-3.5" />
            <FileIcon path={node.name} size="sm" />
            <span className="font-mono text-zinc-400 truncate">{node.name}</span>
          </>
        )}
      </div>
      {isDirectory && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem key={child.path} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
