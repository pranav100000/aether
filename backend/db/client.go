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
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
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
		       status, error_message, base_image, env_vars, last_accessed_at,
		       created_at, updated_at
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
			&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
			&p.CreatedAt, &p.UpdatedAt,
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
		       status, error_message, base_image, env_vars, last_accessed_at,
		       created_at, updated_at
		FROM projects
		WHERE id = $1
	`, projectID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
		&p.CreatedAt, &p.UpdatedAt,
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
		       status, error_message, base_image, env_vars, last_accessed_at,
		       created_at, updated_at
		FROM projects
		WHERE id = $1 AND user_id = $2
	`, projectID, userID)

	var p Project
	err := row.Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	return &p, nil
}

func (c *Client) CreateProject(ctx context.Context, userID, name string, description *string, baseImage string) (*Project, error) {
	var p Project
	err := c.pool.QueryRow(ctx, `
		INSERT INTO projects (user_id, name, description, base_image, status)
		VALUES ($1, $2, $3, $4, 'stopped')
		RETURNING id, user_id, name, description, fly_machine_id, fly_volume_id,
		          status, error_message, base_image, env_vars, last_accessed_at,
		          created_at, updated_at
	`, userID, name, description, baseImage).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
		&p.CreatedAt, &p.UpdatedAt,
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
		          status, error_message, base_image, env_vars, last_accessed_at,
		          created_at, updated_at
	`, projectID, userID, name, description).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Description,
		&p.FlyMachineID, &p.FlyVolumeID, &p.Status, &p.ErrorMessage,
		&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
		&p.CreatedAt, &p.UpdatedAt,
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
		       status, error_message, base_image, env_vars, last_accessed_at,
		       created_at, updated_at
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
			&p.BaseImage, &p.EnvVars, &p.LastAccessedAt,
			&p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan project: %w", err)
		}
		projects = append(projects, p)
	}

	return projects, nil
}
