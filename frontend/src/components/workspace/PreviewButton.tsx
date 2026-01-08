import { useState } from "react"
import { ExternalLink, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface PreviewButtonProps {
  machineId: string
}

const COMMON_PORTS = [
  { port: 3000, label: "3000 (React/Next)" },
  { port: 5173, label: "5173 (Vite)" },
  { port: 8080, label: "8080 (Go/Java)" },
  { port: 4000, label: "4000 (Phoenix)" },
  { port: 8000, label: "8000 (Django)" },
  { port: 5000, label: "5000 (Flask)" },
]

export function PreviewButton({ machineId }: PreviewButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false)

  const getPreviewUrl = (port: number): string => {
    // Fly.io machines are accessible via their app name and machine ID
    // The URL format is: https://{app-name}.fly.dev
    // For specific ports, Fly uses: https://{machine-id}.vm.{app-name}.internal:{port}
    // But for external access, we use the Fly proxy which routes based on port
    return `https://${machineId}.fly.dev:${port}`
  }

  const handlePreview = (port: number) => {
    const url = getPreviewUrl(port)
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
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded shadow-lg py-1 min-w-[160px]">
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
