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

// Machine represents a compute instance (Fly VM, Docker container, etc.)
// This is a provider-agnostic type used by handlers.
type Machine struct {
	ID        string
	Name      string
	State     string
	Region    string
	PrivateIP string
	CreatedAt string
}

// Volume represents persistent storage (Fly volume, local directory, etc.)
// This is a provider-agnostic type used by handlers.
type Volume struct {
	ID        string
	Name      string
	SizeGB    int
	Region    string
	State     string
	CreatedAt string
}

// MachineConfig contains the configuration for creating a machine.
// This is a provider-agnostic type - implementations convert to provider-specific formats.
type MachineConfig struct {
	Image  string
	Guest  GuestConfig
	Env    map[string]string
	Mounts []Mount
}

// GuestConfig specifies compute resources for a machine.
type GuestConfig struct {
	CPUKind  string
	CPUs     int
	MemoryMB int
	GPUKind  string
}

// Mount specifies a volume mount for a machine.
type Mount struct {
	Volume string
	Path   string
}

// InfraService represents a provisioned infrastructure service.
// This is a provider-agnostic type used by handlers.
type InfraService struct {
	ID           string
	ProjectID    string
	ServiceType  string
	Name         string
	Status       string
	MachineID    string
	VolumeID     string
	Connection   *ConnectionDetails
	ErrorMessage string
	Config       map[string]interface{}
	CreatedAt    string
	UpdatedAt    string
}

// ConnectionDetails contains connection information for an infrastructure service.
type ConnectionDetails struct {
	Host     string            `json:"host"`
	Port     int               `json:"port,omitempty"`
	Ports    map[string]int    `json:"ports,omitempty"`
	Username string            `json:"username,omitempty"`
	Password string            `json:"password,omitempty"`
	URL      string            `json:"url,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
}

// InfraServiceConfig contains configuration for creating an infrastructure service.
type InfraServiceConfig struct {
	ServiceType string
	Name        string
	Config      map[string]interface{}
}
