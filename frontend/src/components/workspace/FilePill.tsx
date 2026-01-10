import { XIcon, FileIcon, FileCodeIcon, FileTextIcon, ImageIcon } from "lucide-react"

interface FilePillProps {
  path: string
  onRemove: () => void
}

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()

  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "cpp", "c", "h"].includes(ext ?? "")) {
    return <FileCodeIcon className="size-3 text-muted-foreground" />
  }

  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext ?? "")) {
    return <ImageIcon className="size-3 text-muted-foreground" />
  }

  if (["md", "txt", "json", "yaml", "yml", "toml", "xml"].includes(ext ?? "")) {
    return <FileTextIcon className="size-3 text-muted-foreground" />
  }

  return <FileIcon className="size-3 text-muted-foreground" />
}

export function FilePill({ path, onRemove }: FilePillProps) {
  const filename = path.split("/").pop()

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
      {getFileIcon(path)}
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
