import { useState } from "react"
import { ExternalLink, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface PreviewButtonProps {
  projectId: string
  previewToken?: string
}

const COMMON_PORTS = [
  { port: 3000, label: "3000 (React/Next)" },
  { port: 5173, label: "5173 (Vite)" },
  { port: 8080, label: "8080 (Go/Java)" },
  { port: 4000, label: "4000 (Phoenix)" },
  { port: 8000, label: "8000 (Django)" },
  { port: 5000, label: "5000 (Flask)" },
]

// Preview domain from env (e.g., "149.248.213.170.nip.io" for dev or "preview.aether.dev" for prod)
const PREVIEW_DOMAIN = import.meta.env.VITE_PREVIEW_DOMAIN || "localhost:8081"

function getPreviewUrl(projectId: string, port: number, token?: string): string {
  const prefix = projectId.substring(0, 8)
  // Format: {port}-{prefix}[-{token}].{domain}
  const subdomain = token ? `${port}-${prefix}-${token}` : `${port}-${prefix}`
  // TODO: Use https once we have a custom domain with wildcard SSL cert
  return `http://${subdomain}.${PREVIEW_DOMAIN}`
}

export function PreviewButton({ projectId, previewToken }: PreviewButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false)

  const handlePreview = (port: number) => {
    const url = getPreviewUrl(projectId, port, previewToken)
    window.open(url, "_blank")
    setShowDropdown(false)
  }

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          onClick={() => handlePreview(3000)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "rounded-l transition-colors"
          )}
          title="Open preview in new tab"
        >
          <ExternalLink className="w-4 h-4" />
          Preview
        </button>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={cn(
            "px-2 py-1.5 border-l border-primary-foreground/20",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "rounded-r transition-colors"
          )}
        >
          <ChevronDown className="w-4 h-5" />
        </button>
      </div>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded shadow-lg py-1 min-w-[180px]">
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
              Select port
            </div>
            {COMMON_PORTS.map(({ port, label }) => (
              <button
                key={port}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                onClick={() => handlePreview(port)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
