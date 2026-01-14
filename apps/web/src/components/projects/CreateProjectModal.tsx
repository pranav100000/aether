import { useState, useEffect, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HardwareSelector } from "./HardwareSelector"
import { useUserSettings } from "@/hooks/useUserSettings"
import {
  HARDWARE_PRESETS,
  IDLE_TIMEOUT_OPTIONS,
  type HardwareConfig,
  type IdleTimeoutMinutes,
} from "@/lib/api"

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (
    name: string,
    description?: string,
    hardware?: HardwareConfig,
    idleTimeoutMinutes?: IdleTimeoutMinutes
  ) => Promise<void>
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const { settings, loading: settingsLoading } = useUserSettings()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [hardware, setHardware] = useState<HardwareConfig>(HARDWARE_PRESETS[0].config)
  const [idleTimeout, setIdleTimeout] = useState<0 | 5 | 10 | 30 | 60>(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Apply user defaults when settings load (select "Default" preset by default)
  useEffect(() => {
    if (settings) {
      setHardware(settings.default_hardware)
      setIdleTimeout(settings.default_idle_timeout_minutes ?? 10)
    }
  }, [settings])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await onCreate(name, description || undefined, hardware, idleTimeout)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">New Project</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/50 rounded-lg text-destructive text-sm">
              {error}
            </div>
          )}

          <Input
            id="name"
            label="Project name"
            placeholder="my-project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <Input
            id="description"
            label="Description (optional)"
            placeholder="What are you building?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {/* Hardware Configuration */}
          <div>
            <label className="text-sm font-medium block mb-2">Hardware Configuration</label>
            {settingsLoading ? (
              <div className="text-sm text-muted-foreground p-4 border rounded-md">
                Loading defaults...
              </div>
            ) : (
              <HardwareSelector
                value={hardware}
                onChange={setHardware}
                defaultConfig={settings?.default_hardware}
              />
            )}
          </div>

          {/* Idle Timeout */}
          <div>
            <label className="text-sm font-medium block mb-2">Idle Timeout</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(parseInt(e.target.value) as 0 | 5 | 10 | 30 | 60)}
            >
              {IDLE_TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Project will automatically stop after this duration of inactivity
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create project
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
