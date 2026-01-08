import { X, Circle } from "lucide-react"
import type { OpenFile } from "@/hooks/useEditor"
import { cn } from "@/lib/utils"

interface EditorTabsProps {
  files: OpenFile[]
  activeFile: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

function getFileName(path: string): string {
  return path.split("/").pop() || path
}

function getFileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()

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

export function EditorTabs({ files, activeFile, onSelect, onClose }: EditorTabsProps) {
  if (files.length === 0) {
    return null
  }

  return (
    <div className="flex items-center bg-[#1a1a1a] border-b border-border overflow-x-auto">
      {files.map((file) => {
        const isActive = file.path === activeFile
        const fileName = getFileName(file.path)
        const iconColor = getFileIcon(file.path)

        return (
          <div
            key={file.path}
            className={cn(
              "flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 group",
              isActive
                ? "bg-[#252525] text-foreground"
                : "bg-[#1a1a1a] text-muted-foreground hover:bg-[#222]"
            )}
            onClick={() => onSelect(file.path)}
          >
            <span className={cn("text-xs", iconColor)}>●</span>
            <span className="truncate text-sm max-w-[120px]" title={file.path}>
              {fileName}
            </span>
            {file.dirty && (
              <Circle className="w-2 h-2 fill-current text-muted-foreground flex-shrink-0" />
            )}
            {file.saving && (
              <span className="text-xs text-muted-foreground flex-shrink-0">saving...</span>
            )}
            <button
              className={cn(
                "p-0.5 rounded hover:bg-muted-foreground/20 flex-shrink-0",
                "opacity-0 group-hover:opacity-100",
                isActive && "opacity-100"
              )}
              onClick={(e) => {
                e.stopPropagation()
                onClose(file.path)
              }}
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
