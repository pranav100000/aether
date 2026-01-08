import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HardwareSelector } from "./HardwareSelector"
import { HARDWARE_PRESETS, type HardwareConfig } from "@/lib/api"

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (name: string, description?: string, hardware?: HardwareConfig) => Promise<void>
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [hardware, setHardware] = useState<HardwareConfig>(HARDWARE_PRESETS[0].config)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await onCreate(name, description || undefined, hardware)
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

          <div>
            <label className="text-sm font-medium block mb-2">Hardware Configuration</label>
            <HardwareSelector value={hardware} onChange={setHardware} />
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
