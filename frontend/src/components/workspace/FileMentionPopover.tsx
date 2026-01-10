import { useEffect, useRef } from "react"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command"
import { FileIcon, FileCodeIcon, FileTextIcon, ImageIcon } from "lucide-react"

interface FileMentionPopoverProps {
  open: boolean
  position: { top: number; left: number } | null
  query: string
  files: string[]
  loading?: boolean
  selectedIndex: number
  onSelect: (file: string) => void
  onClose: () => void
  onQueryChange: (query: string) => void
}

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()

  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "cpp", "c", "h"].includes(ext ?? "")) {
    return <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
  }

  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext ?? "")) {
    return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
  }

  if (["md", "txt", "json", "yaml", "yml", "toml", "xml"].includes(ext ?? "")) {
    return <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
  }

  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />
}

export function FileMentionPopover({
  open,
  position,
  query,
  files,
  loading,
  selectedIndex,
  onSelect,
  onClose,
  onQueryChange,
}: FileMentionPopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  if (!open || !position) return null

  return (
    <Popover open={open} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor
        style={{
          position: "absolute",
          top: position.top,
          left: position.left,
        }}
      />
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="top"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            placeholder="Search files..."
            value={query}
            onValueChange={onQueryChange}
          />
          <CommandList>
            {loading && files.length === 0 && (
              <div className="py-3 px-3 text-xs text-muted-foreground text-center">
                Loading files...
              </div>
            )}
            <CommandEmpty>No files found</CommandEmpty>
            {files.map((file, index) => (
              <CommandItem
                key={file}
                value={file}
                onSelect={() => onSelect(file)}
                className={index === selectedIndex ? "bg-accent" : ""}
              >
                {getFileIcon(file)}
                <span className="truncate ml-2">{file}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
