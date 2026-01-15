import { useState } from "react"
import { ExternalLink, Square } from "lucide-react"
import { cn } from "@/lib/utils"

interface PreviewButtonProps {
  projectId: string
  activePorts: number[]
  previewToken?: string
  /** WebSocket-based killPort function */
  onKillPort: (port: number) => Promise<void>
}

// Preview domain from env (e.g., "149.248.213.170.nip.io" for dev or "preview.aether.dev" for prod)
const PREVIEW_DOMAIN = import.meta.env.VITE_PREVIEW_DOMAIN || "localhost:8081"

function getPreviewUrl(projectId: string, port: number, token?: string): string {
  // For localhost, use direct port access (no subdomain proxy)
  if (PREVIEW_DOMAIN.startsWith("localhost")) {
    return `http://localhost:${port}`
  }

  const prefix = projectId.substring(0, 8)
  // Format: {port}-{prefix}[-{token}].{domain}
  const subdomain = token ? `${port}-${prefix}-${token}` : `${port}-${prefix}`
  // TODO: Use https once we have a custom domain with wildcard SSL cert
  return `http://${subdomain}.${PREVIEW_DOMAIN}`
}

export function PreviewButton({ projectId, activePorts, previewToken, onKillPort }: PreviewButtonProps) {
  const [killingPorts, setKillingPorts] = useState<Set<number>>(new Set())

  const openPreview = (port: number) => {
    const url = getPreviewUrl(projectId, port, previewToken)
    window.open(url, "_blank")
  }

  const handleKillPort = async (port: number) => {
    setKillingPorts((prev) => new Set(prev).add(port))
    try {
      await onKillPort(port)
      // Port will be removed from activePorts via WebSocket port_change event
    } catch (error) {
      console.error("Failed to kill port:", error)
    } finally {
      setKillingPorts((prev) => {
        const next = new Set(prev)
        next.delete(port)
        return next
      })
    }
  }

  if (activePorts.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      {activePorts.map((port) => (
        <div key={port} className="flex items-center">
          <button
            onClick={() => openPreview(port)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "rounded-l transition-colors"
            )}
            title={`Open port ${port} in new tab`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {"Port " + port}
          </button>
          <button
            onClick={() => handleKillPort(port)}
            disabled={killingPorts.has(port)}
            className={cn(
              "px-1.5 py-1.5 border-l border-primary-foreground/20",
              "bg-primary text-primary-foreground hover:bg-destructive hover:text-destructive-foreground",
              "rounded-r transition-colors",
              killingPorts.has(port) && "opacity-50 cursor-not-allowed"
            )}
            title={`Stop process on port ${port}`}
          >
            <Square className="w-3.5 h-5" />
          </button>
        </div>
      ))}
    </div>
  )
}
