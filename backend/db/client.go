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
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	Name           string     `json:"name"`
	Description    *string    `json:"description,omitempty"`
	FlyMachineID   *string    `json:"fly_machine_id,omitempty"`
	FlyVolumeID    *string    `json:"fly_volume_id,omitempty"`
	Status         string     `json:"status"`
	ErrorMessage   *string    `json:"error_message,omitempty"`
	BaseImage      string     `json:"base_image"`
	EnvVars        any        `json:"env_vars"`
	CPUKind        string     `json:"cpu_kind"`
	CPUs           int        `json:"cpus"`
	MemoryMB       int        `json:"memory_mb"`
	VolumeSizeGB   int        `json:"volume_size_gb"`
	GPUKind        *string    `json:"gpu_kind,omitempty"`
	PreviewToken   *string    `json:"preview_token,omitempty"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// HardwareConfig represents VM hardware configuration
type HardwareConfig struct {
	CPUKind      string
	CPUs         int
	MemoryMB     int
	VolumeSizeGB int
	GPUKind      *string
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
		       preview_token, last_accessed_at, created_at, updated_at
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
			&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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
		       preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE id = $1
	`, projectID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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
		       preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE id = $1 AND user_id = $2
	`, projectID, userID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	return &p, nil
}

func (c *Client) CreateProject(ctx context.Context, userID, name string, description *string, baseImage string, hw *HardwareConfig) (*Project, error) {
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
		                      cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind)
		VALUES ($1, $2, $3, $4, 'stopped', $5, $6, $7, $8, $9)
		RETURNING id, user_id, name, description, fly_machine_id, fly_volume_id,
		          status, error_message, base_image, env_vars,
		          cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		          preview_token, last_accessed_at, created_at, updated_at
	`, userID, name, description, baseImage, cpuKind, cpus, memoryMB, volumeSizeGB, gpuKind).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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
		          preview_token, last_accessed_at, created_at, updated_at
	`, projectID, userID, name, description).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars,
		&p.CPUKind, &p.CPUs, &p.MemoryMB, &p.VolumeSizeGB, &p.GPUKind,
		&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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

func (c *Client) GetIdleRunningProjects(ctx context.Context, timeout time.Duration) ([]Project, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
		       status, error_message, base_image, env_vars,
		       cpu_kind, cpus, memory_mb, volume_size_gb, gpu_kind,
		       preview_token, last_accessed_at, created_at, updated_at
		FROM projects
		WHERE status = 'running'
		  AND last_accessed_at < now() - $1::interval
	`, timeout.String())
	if err != nil {
		return nil, fmt.Errorf("failed to get idle projects: %w", err)
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
			&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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
		       preview_token, last_accessed_at, created_at, updated_at
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
		&p.PreviewToken, &p.LastAccessedAt, &p.CreatedAt, &p.UpdatedAt,
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
