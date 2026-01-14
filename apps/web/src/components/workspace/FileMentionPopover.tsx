import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { FileIcon } from "@/components/icons/FileIcon"

interface FileMentionPopoverProps {
  open: boolean
  position: { top: number; left: number } | null
  files: string[]
  loading?: boolean
  selectedIndex: number
  onSelect: (file: string) => void
}

export function FileMentionPopover({
  open,
  position,
  files,
  loading,
  selectedIndex,
  onSelect,
}: FileMentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const selectedElement = listRef.current.querySelector('[data-selected="true"]')
    selectedElement?.scrollIntoView({ block: "nearest" })
  }, [open, selectedIndex])

  if (!open || !position) return null

  return (
    <div
      className="absolute z-50 w-72 rounded-md border border-border bg-popover shadow-md"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateY(-100%) translateY(-8px)",
      }}
    >
      <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
        {loading && files.length === 0 && (
          <div className="py-3 px-3 text-xs text-muted-foreground text-center">
            Loading files...
          </div>
        )}
        {!loading && files.length === 0 && (
          <div className="py-3 px-3 text-xs text-muted-foreground text-center">
            No files found
          </div>
        )}
        {files.map((file, index) => (
          <div
            key={file}
            data-selected={index === selectedIndex}
            onClick={() => onSelect(file)}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            )}
          >
            <FileIcon path={file} size="md" colorClassName="text-muted-foreground" />
            <span className="truncate">{file}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
