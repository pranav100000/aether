// =============================================================================
// Hardware Configuration Types - Shared across web and API
// =============================================================================

/** CPU kind options */
export type CpuKind = "shared" | "performance";

/** GPU kind options */
export type GpuKind = "a10" | "l40s" | "a100-40gb" | "a100-80gb";

/** Hardware configuration for VMs */
export interface HardwareConfig {
  cpu_kind: CpuKind;
  cpus: number;
  memory_mb: number;
  volume_size_gb: number;
  gpu_kind?: GpuKind | null;
}

/** Hardware preset with metadata */
export interface HardwarePreset {
  id: string;
  name: string;
  description: string;
  config: HardwareConfig;
}

/** Predefined hardware presets */
export const HARDWARE_PRESETS: HardwarePreset[] = [
  {
    id: "small",
    name: "Small",
    description: "1 shared CPU, 1GB RAM, 5GB storage",
    config: { cpu_kind: "shared", cpus: 1, memory_mb: 1024, volume_size_gb: 5 },
  },
  {
    id: "medium",
    name: "Medium",
    description: "2 shared CPUs, 2GB RAM, 10GB storage",
    config: { cpu_kind: "shared", cpus: 2, memory_mb: 2048, volume_size_gb: 10 },
  },
  {
    id: "large",
    name: "Large",
    description: "4 shared CPUs, 4GB RAM, 20GB storage",
    config: { cpu_kind: "shared", cpus: 4, memory_mb: 4096, volume_size_gb: 20 },
  },
  {
    id: "performance",
    name: "Performance",
    description: "2 performance CPUs, 4GB RAM, 20GB storage",
    config: { cpu_kind: "performance", cpus: 2, memory_mb: 4096, volume_size_gb: 20 },
  },
] as const;

/** Get preset by ID */
export function getPresetById(id: string): HardwarePreset | undefined {
  return HARDWARE_PRESETS.find((p) => p.id === id);
}

/** Valid idle timeout values in minutes (0 = never) */
export const IDLE_TIMEOUT_VALUES = [0, 5, 10, 30, 60] as const;
export type IdleTimeoutMinutes = (typeof IDLE_TIMEOUT_VALUES)[number] | null;

/** Idle timeout options for UI */
export const IDLE_TIMEOUT_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 0, label: "Never (manual stop only)" },
] as const;
