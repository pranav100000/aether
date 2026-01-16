package infra

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// GuestConfig specifies compute resources for a service
type GuestConfig struct {
	CPUKind  string
	CPUs     int
	MemoryMB int
	GPUKind  string
}

// ServiceDefinition defines how to provision an infrastructure service type
type ServiceDefinition struct {
	// Type is the unique identifier for this service (e.g., "supabase", "redis")
	Type string

	// DisplayName is the human-readable name
	DisplayName string

	// Description explains what this service provides
	Description string

	// Image is the Docker/Fly image to use
	Image string

	// Guest specifies compute resources
	Guest GuestConfig

	// Ports lists the ports exposed by this service
	Ports []PortConfig

	// Volumes lists persistent storage requirements
	Volumes []VolumeConfig

	// EnvTemplate contains environment variables with placeholders
	// Supported placeholders: {{.GeneratedPassword}}, {{.GeneratedJWTSecret}}, {{.GeneratedAnonKey}}, {{.GeneratedServiceKey}}
	EnvTemplate map[string]string
}

// PortConfig defines a port exposed by a service
type PortConfig struct {
	// Name is a human-readable identifier (e.g., "postgres", "api")
	Name string

	// InternalPort is the port inside the container
	InternalPort int

	// Protocol is "tcp" or "http"
	Protocol string
}

// VolumeConfig defines persistent storage for a service
type VolumeConfig struct {
	// Name is an identifier for this volume
	Name string

	// Path is where to mount the volume in the container
	Path string

	// SizeGB is the minimum size in gigabytes
	SizeGB int
}

// Registry holds all available service definitions
type Registry struct {
	services map[string]ServiceDefinition
}

// NewRegistry creates a new registry with default service definitions
func NewRegistry() *Registry {
	r := &Registry{
		services: make(map[string]ServiceDefinition),
	}
	r.registerDefaults()
	return r
}

// registerDefaults adds built-in service definitions
func (r *Registry) registerDefaults() {
	// Supabase - full stack (Postgres + PostgREST + GoTrue + Realtime + Studio)
	r.Register(ServiceDefinition{
		Type:        "supabase",
		DisplayName: "Supabase",
		Description: "Full Supabase stack: PostgreSQL + PostgREST API + GoTrue auth + Realtime + Studio",
		Image:       "supabase/postgres:15.1.1.41", // Start with postgres, can upgrade to full stack
		Guest: GuestConfig{
			CPUKind:  "shared",
			CPUs:     2,
			MemoryMB: 2048,
			GPUKind:  "",
		},
		Ports: []PortConfig{
			{Name: "postgres", InternalPort: 5432, Protocol: "tcp"},
			// Future: Add these when using full stack image
			// {Name: "api", InternalPort: 3000, Protocol: "http"},
			// {Name: "auth", InternalPort: 9999, Protocol: "http"},
			// {Name: "realtime", InternalPort: 4000, Protocol: "tcp"},
			// {Name: "studio", InternalPort: 3001, Protocol: "http"},
		},
		Volumes: []VolumeConfig{
			{Name: "data", Path: "/var/lib/postgresql/data", SizeGB: 1},
		},
		EnvTemplate: map[string]string{
			"POSTGRES_USER":     "postgres",
			"POSTGRES_PASSWORD": "{{.GeneratedPassword}}",
			"POSTGRES_DB":       "postgres",
			// Future: Add these when using full stack image
			// "JWT_SECRET":       "{{.GeneratedJWTSecret}}",
			// "ANON_KEY":         "{{.GeneratedAnonKey}}",
			// "SERVICE_ROLE_KEY": "{{.GeneratedServiceKey}}",
		},
	})

	// Redis - in-memory data store
	r.Register(ServiceDefinition{
		Type:        "redis",
		DisplayName: "Redis",
		Description: "In-memory data store for caching and message queues",
		Image:       "redis:7-alpine",
		Guest: GuestConfig{
			CPUKind:  "shared",
			CPUs:     1,
			MemoryMB: 256,
			GPUKind:  "",
		},
		Ports: []PortConfig{
			{Name: "redis", InternalPort: 6379, Protocol: "tcp"},
		},
		Volumes:     []VolumeConfig{}, // Redis can be ephemeral for caching
		EnvTemplate: map[string]string{},
	})
}

// Register adds or updates a service definition
func (r *Registry) Register(def ServiceDefinition) {
	r.services[def.Type] = def
}

// Get retrieves a service definition by type
func (r *Registry) Get(serviceType string) (ServiceDefinition, bool) {
	def, ok := r.services[serviceType]
	return def, ok
}

// List returns all registered service definitions
func (r *Registry) List() []ServiceDefinition {
	result := make([]ServiceDefinition, 0, len(r.services))
	for _, def := range r.services {
		result = append(result, def)
	}
	return result
}

// IsAvailable checks if a service type is registered
func (r *Registry) IsAvailable(serviceType string) bool {
	_, ok := r.services[serviceType]
	return ok
}

// GeneratedEnv contains generated values for environment variable templates
type GeneratedEnv struct {
	GeneratedPassword   string
	GeneratedJWTSecret  string
	GeneratedAnonKey    string
	GeneratedServiceKey string
}

// GenerateSecrets creates secure random values for service configuration
func GenerateSecrets() (*GeneratedEnv, error) {
	password, err := generateRandomString(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate password: %w", err)
	}

	jwtSecret, err := generateRandomString(64)
	if err != nil {
		return nil, fmt.Errorf("failed to generate JWT secret: %w", err)
	}

	anonKey, err := generateRandomString(64)
	if err != nil {
		return nil, fmt.Errorf("failed to generate anon key: %w", err)
	}

	serviceKey, err := generateRandomString(64)
	if err != nil {
		return nil, fmt.Errorf("failed to generate service key: %w", err)
	}

	return &GeneratedEnv{
		GeneratedPassword:   password,
		GeneratedJWTSecret:  jwtSecret,
		GeneratedAnonKey:    anonKey,
		GeneratedServiceKey: serviceKey,
	}, nil
}

// BuildEnv creates environment variables from a template and generated secrets
func BuildEnv(template map[string]string, secrets *GeneratedEnv) map[string]string {
	env := make(map[string]string, len(template))
	for k, v := range template {
		switch v {
		case "{{.GeneratedPassword}}":
			env[k] = secrets.GeneratedPassword
		case "{{.GeneratedJWTSecret}}":
			env[k] = secrets.GeneratedJWTSecret
		case "{{.GeneratedAnonKey}}":
			env[k] = secrets.GeneratedAnonKey
		case "{{.GeneratedServiceKey}}":
			env[k] = secrets.GeneratedServiceKey
		default:
			env[k] = v
		}
	}
	return env
}

// generateRandomString creates a secure random string of the specified length
func generateRandomString(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes)[:length], nil
}
