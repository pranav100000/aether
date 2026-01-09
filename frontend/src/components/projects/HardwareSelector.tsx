import { useState, useEffect } from "react"
import { HARDWARE_PRESETS, type HardwareConfig } from "@/lib/api"

interface HardwareSelectorProps {
  value: HardwareConfig
  onChange: (config: HardwareConfig) => void
  defaultConfig?: HardwareConfig | null
}

function formatHardwareDescription(config: HardwareConfig): string {
  const cpuDesc = `${config.cpus} ${config.cpu_kind} CPU${config.cpus > 1 ? "s" : ""}`
  const memDesc = config.memory_mb >= 1024 ? `${config.memory_mb / 1024}GB RAM` : `${config.memory_mb}MB RAM`
  const storageDesc = `${config.volume_size_gb}GB storage`
  const parts = [cpuDesc, memDesc, storageDesc]
  if (config.gpu_kind) {
    parts.push(config.gpu_kind.toUpperCase())
  }
  return parts.join(", ")
}

export function HardwareSelector({ value, onChange, defaultConfig }: HardwareSelectorProps) {
  const [mode, setMode] = useState<"preset" | "custom">("preset")
  const [selectedPreset, setSelectedPreset] = useState(defaultConfig ? "default" : "small")

  // Update selected preset when defaultConfig becomes available
  useEffect(() => {
    if (defaultConfig && selectedPreset === "small") {
      setSelectedPreset("default")
      onChange(defaultConfig)
    }
  }, [defaultConfig])

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId)
    if (presetId === "default" && defaultConfig) {
      onChange(defaultConfig)
    } else {
      const preset = HARDWARE_PRESETS.find((p) => p.id === presetId)
      if (preset) {
        onChange(preset.config)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 border-b border-border">
        <button
          type="button"
          className={`pb-2 px-1 text-sm ${mode === "preset" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => setMode("preset")}
        >
          Presets
        </button>
        <button
          type="button"
          className={`pb-2 px-1 text-sm ${mode === "custom" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => setMode("custom")}
        >
          Custom
        </button>
      </div>

      {mode === "preset" ? (
        <div className="grid grid-cols-2 gap-3">
          {/* Default preset - shown first when user has default settings */}
          {defaultConfig && (
            <button
              type="button"
              className={`p-3 border rounded-lg text-left transition-colors ${
                selectedPreset === "default"
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => handlePresetChange("default")}
            >
              <div className="font-medium text-sm">Default</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatHardwareDescription(defaultConfig)}
              </div>
            </button>
          )}
          {HARDWARE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`p-3 border rounded-lg text-left transition-colors ${
                selectedPreset === preset.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => handlePresetChange(preset.id)}
            >
              <div className="font-medium text-sm">{preset.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{preset.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* CPU Kind */}
          <div>
            <label className="text-sm font-medium block mb-1">CPU Type</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={value.cpu_kind}
              onChange={(e) => onChange({ ...value, cpu_kind: e.target.value as "shared" | "performance" })}
            >
              <option value="shared">Shared</option>
              <option value="performance">Performance</option>
            </select>
          </div>

          {/* CPUs */}
          <div>
            <label className="text-sm font-medium block mb-1">CPU Cores</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={value.cpus}
              onChange={(e) => onChange({ ...value, cpus: parseInt(e.target.value) })}
            >
              {(value.cpu_kind === "shared" ? [1, 2, 4, 8] : [1, 2, 4, 8, 16]).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "core" : "cores"}
                </option>
              ))}
            </select>
          </div>

          {/* Memory */}
          <div>
            <label className="text-sm font-medium block mb-1">Memory</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={value.memory_mb}
              onChange={(e) => onChange({ ...value, memory_mb: parseInt(e.target.value) })}
            >
              {[256, 512, 1024, 2048, 4096, 8192, 16384, 32768].map((mb) => (
                <option key={mb} value={mb}>
                  {mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`}
                </option>
              ))}
            </select>
          </div>

          {/* Volume Size */}
          <div>
            <label className="text-sm font-medium block mb-1">Storage</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={value.volume_size_gb}
              onChange={(e) => onChange({ ...value, volume_size_gb: parseInt(e.target.value) })}
            >
              {[1, 5, 10, 20, 50, 100, 200, 500].map((gb) => (
                <option key={gb} value={gb}>
                  {gb}GB
                </option>
              ))}
            </select>
          </div>

          {/* GPU (optional) */}
          <div>
            <label className="text-sm font-medium block mb-1">GPU (Optional)</label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={value.gpu_kind || ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  gpu_kind: (e.target.value || null) as HardwareConfig["gpu_kind"],
                })
              }
            >
              <option value="">None</option>
              <option value="a10">NVIDIA A10</option>
              <option value="l40s">NVIDIA L40S</option>
              <option value="a100-40gb">NVIDIA A100 40GB</option>
              <option value="a100-80gb">NVIDIA A100 80GB</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
