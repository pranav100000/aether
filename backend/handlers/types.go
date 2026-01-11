package handlers

// HardwareConfig represents hardware configuration for projects
// Used in both project responses and user settings
type HardwareConfig struct {
	CPUKind      string  `json:"cpu_kind"`
	CPUs         int     `json:"cpus"`
	MemoryMB     int     `json:"memory_mb"`
	VolumeSizeGB int     `json:"volume_size_gb"`
	GPUKind      *string `json:"gpu_kind,omitempty"`
}
