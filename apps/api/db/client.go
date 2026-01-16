package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

type Client struct {
	pool *pgxpool.Pool
}

type Profile struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Project struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	Name               string     `json:"name"`
	Description        *string    `json:"description,omitempty"`
	FlyMachineID       *string    `json:"fly_machine_id,omitempty"`
	FlyVolumeID        *string    `json:"fly_volume_id,omitempty"`
	Status             string     `json:"status"`
	ErrorMessage       *string    `json:"error_message,omitempty"`
	BaseImage          string     `json:"base_image"`
	EnvVars            any        `json:"env_vars"`
	CPUKind            string     `json:"cpu_kind"`
	CPUs               int        `json:"cpus"`
	MemoryMB           int        `json:"memory_mb"`
	VolumeSizeGB       int        `json:"volume_size_gb"`
	GPUKind            *string    `json:"gpu_kind,omitempty"`
	IdleTimeoutMinutes *int       `json:"idle_timeout_minutes,omitempty"`
	PreviewToken       *string    `json:"preview_token,omitempty"`
	LastAccessedAt     *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// HardwareConfig represents VM hardware configuration
type HardwareConfig struct {
	CPUKind      string
	CPUs         int
	MemoryMB     int
	VolumeSizeGB int
	GPUKind      *string
}

// UserSettings represents user default preferences
type UserSettings struct {
	UserID                    string    `json:"user_id"`
	DefaultCPUKind            string    `json:"default_cpu_kind"`
	DefaultCPUs               int       `json:"default_cpus"`
	DefaultMemoryMB           int       `json:"default_memory_mb"`
	DefaultVolumeSizeGB       int       `json:"default_volume_size_gb"`
	DefaultGPUKind            *string   `json:"default_gpu_kind,omitempty"`
	DefaultIdleTimeoutMinutes int       `json:"default_idle_timeout_minutes"`
	CreatedAt                 time.Time `json:"created_at"`
	UpdatedAt                 time.Time `json:"updated_at"`
}

func NewClient(databaseURL string) (*Client, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// Connection pool settings
	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Client{pool: pool}, nil
}

func (c *Client) Close() {
	c.pool.Close()
}

// Ping verifies database connectivity
func (c *Client) Ping(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

// ============================================
// Profile Methods
// ============================================

func (c *Client) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, email, display_name, created_at, updated_at
		FROM profiles
		WHERE id = $1
	`, userID)

	var p Profile
	err := row.Scan(&p.ID, &p.Email, &p.DisplayName, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	return &p, nil
}

func (c *Client) UpdateProfile(ctx context.Context, userID string, displayName string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE profiles SET display_name = $1 WHERE id = $2
	`, displayName, userID)
	return err
}

// ============================================
// Project Methods
// ============================================

func (c *Client) ListProjects(ctx context.Context, userID string) ([]Project, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list projects: %w", err)
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Description,
			&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
			&p.BaseImage, &p.EnvVars,
			&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
			&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan project: %w", err)
		}
		projects = append(projects, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating projects: %w", err)
	}

	return projects, nil
}

func (c *Client) GetProject(ctx context.Context, projectID string) (*Project, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE id = $1
	`, projectID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	return &p, nil
}

func (c *Client) GetProjectByUser(ctx context.Context, projectID, userID string) (*Project, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE id = $1 AND user_id = $2
	`, projectID, userID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	return &p, nil
}

func (c *Client) CreateProject(ctx context.Context, userID, name string, description *string, baseImage string, hw *HardwareConfig, idleTimeoutMinutes *int) (*Project, error) {
	// Use defaults if hardware config is nil
	cpuKind := "shared"
	cpus := 1
	memoryMB := 1024
	volumeSizeGB := 5
	var gpuKind *string

	if hw != nil {
		cpuKind = hw.CPUKind
		cpus = hw.CPUs
		memoryMB = hw.MemoryMB
		volumeSizeGB = hw.VolumeSizeGB
		gpuKind = hw.GPUKind
	}

	var p Project
	err := c.pool.QueryRow(ctx, `
		INSERT INTO projects (user_id, name, description, base_image, status,
		                      cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind, idle_timeout_minutes)
		VALUES ($1, $2, $3, $4, 'stopped', $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, name, description, fly_machine_id, fly_volume_id,
		          status, error_message, base_image, env_vars,
		          cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		          idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
	`, userID, name, description, baseImage, cpuKind, cpus, memoryMB, volumeSizeGB, gpuKind, idleTimeoutMinutes).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}

	return &p, nil
}

func (c *Client) UpdateProject(ctx context.Context, projectID, userID string, name, description *string) (*Project, error) {
	var p Project
	err := c.pool.QueryRow(ctx, `
		UPDATE projects
		SET name = COALESCE($3, name),
		    description = COALESCE($4, description)
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, description, fly_machine_id, fly_volume_id,
		          status, error_message, base_image, env_vars,
		          cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		          idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
	`, projectID, userID, name, description).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to update project: %w", err)
	}

	return &p, nil
}

func (c *Client) DeleteProject(ctx context.Context, projectID, userID string) error {
	result, err := c.pool.Exec(ctx, `
		DELETE FROM projects WHERE id = $1 AND user_id = $2
	`, projectID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete project: %w", err)
	}

	if result.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (c *Client) UpdateProjectStatus(ctx context.Context, projectID, status string, errorMsg *string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE projects SET status = $1, error_message = $2 WHERE id = $3
	`, status, errorMsg, projectID)
	if err != nil {
		return fmt.Errorf("failed to update project status: %w", err)
	}
	return nil
}

func (c *Client) UpdateProjectMachine(ctx context.Context, projectID, machineID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE projects SET fly_machine_id = $1 WHERE id = $2
	`, machineID, projectID)
	if err != nil {
		return fmt.Errorf("failed to update project machine: %w", err)
	}
	return nil
}

func (c *Client) UpdateProjectVolume(ctx context.Context, projectID, volumeID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE projects SET fly_volume_id = $1 WHERE id = $2
	`, volumeID, projectID)
	if err != nil {
		return fmt.Errorf("failed to update project volume: %w", err)
	}
	return nil
}

func (c *Client) UpdateProjectLastAccessed(ctx context.Context, projectID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE projects SET last_accessed_at = now() WHERE id = $1
	`, projectID)
	if err != nil {
		return fmt.Errorf("failed to update last accessed: %w", err)
	}
	return nil
}

// GetRunningProjects returns all running projects for idle checking
// The caller handles per-project timeout logic
func (c *Client) GetRunningProjects(ctx context.Context) ([]Project, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE status = 'running'
		  AND last_accessed_at IS NOT NULL
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to get running projects: %w", err)
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Description,
			&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
			&p.BaseImage, &p.EnvVars,
			&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
			&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan project: %w", err)
		}
		projects = append(projects, p)
	}

	return projects, nil
}

// GetProjectByIDPrefix finds a running project by ID prefix (first 8 chars)
// Used by the gateway proxy to resolve subdomain to full project
func (c *Client) GetProjectByIDPrefix(ctx context.Context, prefix string) (*Project, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       idle_timeout_minutes, preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE id::text LIKE $1 || '%'
		  AND status = 'running'
		LIMIT 1
	`, prefix)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.IdleTimeoutMinutes, &p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project by prefix: %w", err)
	}

	return &p, nil
}

// ============================================
// API Keys Methods
// ============================================

// GetUserAPIKeys retrieves the encrypted API keys for a user
func (c *Client) GetUserAPIKeys(ctx context.Context, userID string) (*string, error) {
	var encryptedKeys *string
	err := c.pool.QueryRow(ctx, `
		SELECT api_keys_encrypted
		FROM profiles
		WHERE id = $1
	`, userID).Scan(&encryptedKeys)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get user api keys: %w", err)
	}
	return encryptedKeys, nil
}

// SetUserAPIKeys updates the encrypted API keys for a user
func (c *Client) SetUserAPIKeys(ctx context.Context, userID string, encrypted *string) error {
	result, err := c.pool.Exec(ctx, `
		UPDATE profiles
		SET api_keys_encrypted = $1, updated_at = now()
		WHERE id = $2
	`, encrypted, userID)
	if err != nil {
		return fmt.Errorf("failed to set user api keys: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ============================================
// User Settings Methods
// ============================================

// Default user settings values
const (
	DefaultCPUKind            = "shared"
	DefaultCPUs               = 1
	DefaultMemoryMB           = 1024
	DefaultVolumeSizeGB       = 5
	DefaultIdleTimeoutMinutes = 30
)

// InitializeUserSettings creates default settings for a new user.
// Uses INSERT ON CONFLICT DO NOTHING so it's safe to call multiple times.
func (c *Client) InitializeUserSettings(ctx context.Context, userID string) error {
	defaultTimeout := DefaultIdleTimeoutMinutes
	_, err := c.pool.Exec(ctx, `
		INSERT INTO user_settings (
			user_id, default_cpu_kind, default_cpus, default_memory_mb,
			default_volume_size_gb, default_gpu_kind, default_idle_timeout_minutes
		) VALUES ($1, $2, $3, $4, $5, NULL, $6)
		ON CONFLICT (user_id) DO NOTHING
	`, userID, DefaultCPUKind, DefaultCPUs, DefaultMemoryMB, DefaultVolumeSizeGB, defaultTimeout)
	if err != nil {
		return fmt.Errorf("failed to initialize user settings: %w", err)
	}
	return nil
}

// GetUserSettings retrieves user settings, initializing with defaults if not exists
func (c *Client) GetUserSettings(ctx context.Context, userID string) (*UserSettings, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT user_id, default_cpu_kind, default_cpus, default_memory_mb,
		       default_volume_size_gb, default_gpu_kind, default_idle_timeout_minutes,
		       created_at, updated_at
		FROM user_settings
		WHERE user_id = $1
	`, userID)

	var s UserSettings
	err := row.Scan(
		&s.UserID, &s.DefaultCPUKind, &s.DefaultCPUs, &s.DefaultMemoryMB,
		&s.DefaultVolumeSizeGB, &s.DefaultGPUKind, &s.DefaultIdleTimeoutMinutes,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Initialize settings for new user
			if initErr := c.InitializeUserSettings(ctx, userID); initErr != nil {
				return nil, initErr
			}
			// Re-fetch after initialization
			return c.GetUserSettings(ctx, userID)
		}
		return nil, fmt.Errorf("failed to get user settings: %w", err)
	}

	return &s, nil
}

// UpdateUserSettings updates user default settings, initializing if not exists
func (c *Client) UpdateUserSettings(ctx context.Context, userID string, settings *UserSettings) (*UserSettings, error) {
	var s UserSettings
	err := c.pool.QueryRow(ctx, `
		UPDATE user_settings
		SET default_cpu_kind = $2,
		    default_cpus = $3,
		    default_memory_mb = $4,
		    default_volume_size_gb = $5,
		    default_gpu_kind = $6,
		    default_idle_timeout_minutes = $7
		WHERE user_id = $1
		RETURNING user_id, default_cpu_kind, default_cpus, default_memory_mb,
		          default_volume_size_gb, default_gpu_kind, default_idle_timeout_minutes,
		          created_at, updated_at
	`, userID, settings.DefaultCPUKind, settings.DefaultCPUs, settings.DefaultMemoryMB,
		settings.DefaultVolumeSizeGB, settings.DefaultGPUKind, settings.DefaultIdleTimeoutMinutes).Scan(
		&s.UserID, &s.DefaultCPUKind, &s.DefaultCPUs, &s.DefaultMemoryMB,
		&s.DefaultVolumeSizeGB, &s.DefaultGPUKind, &s.DefaultIdleTimeoutMinutes,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Initialize settings for new user, then retry update
			if initErr := c.InitializeUserSettings(ctx, userID); initErr != nil {
				return nil, initErr
			}
			return c.UpdateUserSettings(ctx, userID, settings)
		}
		return nil, fmt.Errorf("failed to update user settings: %w", err)
	}

	return &s, nil
}

// ============================================
// Infrastructure Service Methods
// ============================================

// InfraService represents an infrastructure service (database, cache, etc.)
type InfraService struct {
	ID                         string     `json:"id"`
	ProjectID                  string     `json:"project_id"`
	ServiceType                string     `json:"service_type"`
	Name                       *string    `json:"name,omitempty"`
	FlyMachineID               *string    `json:"fly_machine_id,omitempty"`
	FlyVolumeID                *string    `json:"fly_volume_id,omitempty"`
	Status                     string     `json:"status"`
	ErrorMessage               *string    `json:"error_message,omitempty"`
	ConnectionDetailsEncrypted *string    `json:"connection_details_encrypted,omitempty"`
	Config                     any        `json:"config"`
	CreatedAt                  time.Time  `json:"created_at"`
	UpdatedAt                  time.Time  `json:"updated_at"`
}

// CreateInfraService creates a new infrastructure service record
func (c *Client) CreateInfraService(ctx context.Context, projectID, serviceType string, name *string, config any) (*InfraService, error) {
	var s InfraService
	err := c.pool.QueryRow(ctx, `
		INSERT INTO infra_services (project_id, service_type, name, config, status)
		VALUES ($1, $2, $3, $4, 'provisioning')
		RETURNING id, project_id, service_type, name, fly_machine_id, fly_volume_id,
		          status, error_message, connection_details_encrypted, config,
		          created_at, updated_at
	`, projectID, serviceType, name, config).Scan(
		&s.ID, &s.ProjectID, &s.ServiceType, &s.Name,
		&s.FlyMachineID, &s.FlyVolumeID, &s.Status, &s.ErrorMessage,
		&s.ConnectionDetailsEncrypted, &s.Config,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create infra service: %w", err)
	}

	return &s, nil
}

// GetInfraService retrieves an infrastructure service by ID
func (c *Client) GetInfraService(ctx context.Context, serviceID string) (*InfraService, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, project_id, service_type, name, fly_machine_id, fly_volume_id,
		       status, error_message, connection_details_encrypted, config,
		       created_at, updated_at
		FROM infra_services
		WHERE id = $1
	`, serviceID)

	var s InfraService
	err := row.Scan(
		&s.ID, &s.ProjectID, &s.ServiceType, &s.Name,
		&s.FlyMachineID, &s.FlyVolumeID, &s.Status, &s.ErrorMessage,
		&s.ConnectionDetailsEncrypted, &s.Config,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get infra service: %w", err)
	}

	return &s, nil
}

// GetInfraServiceByProject retrieves an infrastructure service verifying project ownership
func (c *Client) GetInfraServiceByProject(ctx context.Context, serviceID, projectID string) (*InfraService, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, project_id, service_type, name, fly_machine_id, fly_volume_id,
		       status, error_message, connection_details_encrypted, config,
		       created_at, updated_at
		FROM infra_services
		WHERE id = $1 AND project_id = $2
	`, serviceID, projectID)

	var s InfraService
	err := row.Scan(
		&s.ID, &s.ProjectID, &s.ServiceType, &s.Name,
		&s.FlyMachineID, &s.FlyVolumeID, &s.Status, &s.ErrorMessage,
		&s.ConnectionDetailsEncrypted, &s.Config,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get infra service: %w", err)
	}

	return &s, nil
}

// ListInfraServices retrieves all infrastructure services for a project
func (c *Client) ListInfraServices(ctx context.Context, projectID string) ([]InfraService, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, project_id, service_type, name, fly_machine_id, fly_volume_id,
		       status, error_message, connection_details_encrypted, config,
		       created_at, updated_at
		FROM infra_services
		WHERE project_id = $1 AND status != 'deleted'
		ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to list infra services: %w", err)
	}
	defer rows.Close()

	var services []InfraService
	for rows.Next() {
		var s InfraService
		err := rows.Scan(
			&s.ID, &s.ProjectID, &s.ServiceType, &s.Name,
			&s.FlyMachineID, &s.FlyVolumeID, &s.Status, &s.ErrorMessage,
			&s.ConnectionDetailsEncrypted, &s.Config,
			&s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan infra service: %w", err)
		}
		services = append(services, s)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating infra services: %w", err)
	}

	return services, nil
}

// UpdateInfraServiceStatus updates the status of an infrastructure service
func (c *Client) UpdateInfraServiceStatus(ctx context.Context, serviceID, status string, errorMsg *string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE infra_services SET status = $1, error_message = $2 WHERE id = $3
	`, status, errorMsg, serviceID)
	if err != nil {
		return fmt.Errorf("failed to update infra service status: %w", err)
	}
	return nil
}

// UpdateInfraServiceMachine updates the Fly machine ID for an infrastructure service
func (c *Client) UpdateInfraServiceMachine(ctx context.Context, serviceID, machineID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE infra_services SET fly_machine_id = $1 WHERE id = $2
	`, machineID, serviceID)
	if err != nil {
		return fmt.Errorf("failed to update infra service machine: %w", err)
	}
	return nil
}

// UpdateInfraServiceVolume updates the Fly volume ID for an infrastructure service
func (c *Client) UpdateInfraServiceVolume(ctx context.Context, serviceID, volumeID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE infra_services SET fly_volume_id = $1 WHERE id = $2
	`, volumeID, serviceID)
	if err != nil {
		return fmt.Errorf("failed to update infra service volume: %w", err)
	}
	return nil
}

// UpdateInfraServiceConnection updates the encrypted connection details for an infrastructure service
func (c *Client) UpdateInfraServiceConnection(ctx context.Context, serviceID string, connectionDetailsEncrypted string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE infra_services SET connection_details_encrypted = $1 WHERE id = $2
	`, connectionDetailsEncrypted, serviceID)
	if err != nil {
		return fmt.Errorf("failed to update infra service connection: %w", err)
	}
	return nil
}

// DeleteInfraService marks an infrastructure service as deleted
func (c *Client) DeleteInfraService(ctx context.Context, serviceID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE infra_services SET status = 'deleted' WHERE id = $1
	`, serviceID)
	if err != nil {
		return fmt.Errorf("failed to delete infra service: %w", err)
	}
	return nil
}
