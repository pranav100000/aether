package handlers

import (
	"context"
	"io"
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

// TerminalSession defines the interface for terminal sessions (SSH or local PTY)
type TerminalSession interface {
	RequestPTY(term string, cols, rows int) error
	StartShell() error
	Resize(cols, rows int) error
	Write(data []byte) (int, error)
	Read(buf []byte) (int, error)
	Stderr() io.Reader
	Close() error
	Start(cmd string) error
	KeepAlive(interval time.Duration, done <-chan struct{})
}

// TerminalProvider creates terminal sessions
type TerminalProvider interface {
	CreateSession(host string, port int) (TerminalSession, error)
	CreateSessionWithRetry(host string, port int, maxRetries int, retryDelay time.Duration) (TerminalSession, error)
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
