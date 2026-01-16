package handlers

import (
	"context"
	"time"

	"aether/apps/api/db"
)

// ProjectStore defines the database operations needed by ProjectHandler
type ProjectStore interface {
	ListProjects(ctx context.Context, userID string) ([]db.Project, error)
	GetProject(ctx context.Context, projectID string) (*db.Project, error)
	GetProjectByUser(ctx context.Context, projectID, userID string) (*db.Project, error)
	CreateProject(ctx context.Context, userID, name string, description *string, baseImage string, hw *db.HardwareConfig, idleTimeoutMinutes *int) (*db.Project, error)
	UpdateProject(ctx context.Context, projectID, userID string, name, description *string) (*db.Project, error)
	DeleteProject(ctx context.Context, projectID, userID string) error
	UpdateProjectStatus(ctx context.Context, projectID, status string, errorMsg *string) error
	UpdateProjectMachine(ctx context.Context, projectID, machineID string) error
	UpdateProjectVolume(ctx context.Context, projectID, volumeID string) error
	UpdateProjectLastAccessed(ctx context.Context, projectID string) error
	GetRunningProjects(ctx context.Context) ([]db.Project, error)
	GetUserSettings(ctx context.Context, userID string) (*db.UserSettings, error)
}

// MachineManager defines operations for managing compute instances.
// Implementations include Fly.io VMs and local Docker containers.
type MachineManager interface {
	CreateMachine(name string, config MachineConfig) (*Machine, error)
	GetMachine(machineID string) (*Machine, error)
	StartMachine(machineID string) error
	StopMachine(machineID string) error
	DeleteMachine(machineID string) error
	WaitForState(machineID string, state string, timeout time.Duration) error
}

// VolumeManager defines operations for managing persistent storage.
// Implementations include Fly.io volumes and local directories.
type VolumeManager interface {
	CreateVolume(name string, sizeGB int, region string) (*Volume, error)
	GetVolume(volumeID string) (*Volume, error)
	DeleteVolume(volumeID string) error
}

// ComposeStack represents a running docker compose stack
type ComposeStack struct {
	ID        string            // Unique identifier (project name in compose)
	Name      string            // Human-readable name
	Status    string            // running, stopped, etc.
	Services  []string          // List of service names in the stack
	Ports     map[string]int    // Exposed ports by service name
	Env       map[string]string // Environment variables used
	Directory string            // Working directory for the stack
}

// ComposeManager defines operations for managing docker compose stacks.
// Used for multi-container services like Supabase.
type ComposeManager interface {
	// Up starts a compose stack from the given directory
	Up(ctx context.Context, stackID string, composeDir string, env map[string]string) (*ComposeStack, error)

	// Down stops and removes a compose stack
	Down(ctx context.Context, stackID string) error

	// Status gets the current status of a compose stack
	Status(ctx context.Context, stackID string) (*ComposeStack, error)

	// Logs retrieves logs from a compose stack
	Logs(ctx context.Context, stackID string, service string) (string, error)
}

// ConnectionInfo contains connection details for a project's VM
type ConnectionInfo struct {
	Host          string
	Port          int // SSH port (default 2222)
	WebSocketPort int // WebSocket port for agent service (default 3001)
}

// ConnectionResolver resolves project → connection details
// This abstracts away the difference between local Docker containers and Fly VMs
type ConnectionResolver interface {
	GetConnectionInfo(project *db.Project) (*ConnectionInfo, error)
}

// InfraServiceManager defines operations for managing infrastructure services.
// Implementations include Fly.io machines and local Docker containers.
type InfraServiceManager interface {
	// Provision creates a new infrastructure service
	Provision(ctx context.Context, projectID string, serviceType string, name string, config map[string]interface{}) (*InfraService, error)

	// Get retrieves a specific infrastructure service
	Get(ctx context.Context, serviceID string) (*InfraService, error)

	// List retrieves all infrastructure services for a project
	List(ctx context.Context, projectID string) ([]*InfraService, error)

	// Delete removes an infrastructure service
	Delete(ctx context.Context, serviceID string) error

	// Stop stops a running infrastructure service
	Stop(ctx context.Context, serviceID string) error

	// Start starts a stopped infrastructure service
	Start(ctx context.Context, serviceID string) error

	// WaitForReady waits for a service to become ready
	WaitForReady(ctx context.Context, serviceID string, timeout time.Duration) error
}

// ServiceDefinition defines a type of infrastructure service that can be provisioned
type ServiceDefinition struct {
	Type        string
	DisplayName string
	Description string
}

// ServiceRegistry provides available service type definitions
type ServiceRegistry interface {
	// IsAvailable checks if a service type is registered
	IsAvailable(serviceType string) bool
	// List returns all registered service definitions
	List() []ServiceDefinition
}

// InfraServiceStore defines the database operations needed for infrastructure services
type InfraServiceStore interface {
	CreateInfraService(ctx context.Context, projectID, serviceType string, name *string, config any) (*db.InfraService, error)
	GetInfraService(ctx context.Context, serviceID string) (*db.InfraService, error)
	GetInfraServiceByProject(ctx context.Context, serviceID, projectID string) (*db.InfraService, error)
	ListInfraServices(ctx context.Context, projectID string) ([]db.InfraService, error)
	UpdateInfraServiceStatus(ctx context.Context, serviceID, status string, errorMsg *string) error
	UpdateInfraServiceMachine(ctx context.Context, serviceID, machineID string) error
	UpdateInfraServiceVolume(ctx context.Context, serviceID, volumeID string) error
	UpdateInfraServiceConnection(ctx context.Context, serviceID string, connectionDetailsEncrypted string) error
	DeleteInfraService(ctx context.Context, serviceID string) error
}
