package handlers

import (
	"context"
	"time"

	"aether/db"
	"aether/fly"
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

// MachineManager defines the Fly.io operations needed by ProjectHandler
type MachineManager interface {
	CreateMachine(name string, config fly.MachineConfig) (*fly.Machine, error)
	GetMachine(machineID string) (*fly.Machine, error)
	StartMachine(machineID string) error
	StopMachine(machineID string) error
	DeleteMachine(machineID string) error
	WaitForState(machineID string, state string, timeout time.Duration) error
}

// VolumeManager defines the Fly.io volume operations needed by ProjectHandler
type VolumeManager interface {
	CreateVolume(name string, sizeGB int, region string) (*fly.Volume, error)
	GetVolume(volumeID string) (*fly.Volume, error)
	DeleteVolume(volumeID string) error
}
