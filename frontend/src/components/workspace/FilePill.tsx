import { XIcon } from "lucide-react"
import { FileIcon } from "@/components/icons/FileIcon"

interface FilePillProps {
  path: string
  onRemove: () => void
}

export function FilePill({ path, onRemove }: FilePillProps) {
  const filename = path.split("/").pop()

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
      <FileIcon path={path} size="xs" colorClassName="text-muted-foreground" />
      <span className="truncate max-w-[150px]" title={path}>
        {filename}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive transition-colors"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}
