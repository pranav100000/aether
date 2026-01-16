package infra

import (
	"context"
	"fmt"
	"time"

	"aether/apps/api/handlers"
)

// Manager provisions infrastructure services using the existing MachineManager and VolumeManager abstractions.
// For compose-based services (like Supabase), it uses ComposeManager instead.
type Manager struct {
	machineManager handlers.MachineManager
	volumeManager  handlers.VolumeManager
	composeManager handlers.ComposeManager
	registry       *Registry
	region         string
	baseDir        string // Repo root directory for resolving compose paths
}

// NewManager creates a new infrastructure manager using the provided abstractions
func NewManager(
	machineManager handlers.MachineManager,
	volumeManager handlers.VolumeManager,
	composeManager handlers.ComposeManager,
	registry *Registry,
	region string,
	baseDir string,
) *Manager {
	return &Manager{
		machineManager: machineManager,
		volumeManager:  volumeManager,
		composeManager: composeManager,
		registry:       registry,
		region:         region,
		baseDir:        baseDir,
	}
}

// Provision creates a new infrastructure service
func (m *Manager) Provision(ctx context.Context, projectID string, serviceType string, name string, config map[string]interface{}) (*handlers.InfraService, error) {
	// Get service definition
	def, ok := m.registry.Get(serviceType)
	if !ok {
		return nil, fmt.Errorf("unknown service type: %s", serviceType)
	}

	// Generate secrets for the service
	secrets, err := GenerateSecrets()
	if err != nil {
		return nil, fmt.Errorf("failed to generate secrets: %w", err)
	}

	// Build environment variables from template
	env := BuildEnv(def.EnvTemplate, secrets)

	// Use compose or single container based on service definition
	if def.IsCompose() {
		return m.provisionCompose(ctx, projectID, serviceType, name, def, env, secrets)
	}
	return m.provisionMachine(ctx, projectID, serviceType, name, def, env, secrets)
}

// provisionCompose provisions a compose-based service (like Supabase)
func (m *Manager) provisionCompose(ctx context.Context, projectID, serviceType, name string, def ServiceDefinition, env map[string]string, secrets *GeneratedEnv) (*handlers.InfraService, error) {
	// Generate unique stack ID
	stackID := fmt.Sprintf("infra-%s-%s", projectID[:8], serviceType)

	// Start the compose stack
	stack, err := m.composeManager.Up(ctx, stackID, def.ComposePath, env)
	if err != nil {
		return nil, fmt.Errorf("failed to start compose stack: %w", err)
	}

	// Build connection details for compose stack
	conn := &handlers.ConnectionDetails{
		Host:  "localhost", // Compose services are accessible on localhost
		Ports: make(map[string]int),
		Env:   make(map[string]string),
	}

	// Map ports from the stack
	for serviceName, port := range stack.Ports {
		conn.Ports[serviceName] = port
	}

	// Set primary port (kong for supabase)
	if len(def.Ports) > 0 {
		conn.Port = def.Ports[0].InternalPort
	}

	// Build connection URLs based on service type
	switch serviceType {
	case "supabase":
		// Supabase connection details - use default password from .env.example
		// Supabase has many interdependent services that need consistent credentials
		password := "your-super-secret-and-long-postgres-password"
		conn.Username = "postgres"
		conn.Password = password

		// Database URL (direct postgres access)
		dbPort := 5432
		if p, ok := stack.Ports["supabase-db-1"]; ok {
			dbPort = p
		}
		conn.URL = fmt.Sprintf("postgresql://postgres:%s@localhost:%d/postgres", password, dbPort)
		conn.Env["DATABASE_URL"] = conn.URL

		// Supabase API URL (via Kong)
		apiPort := 8000
		if p, ok := stack.Ports["supabase-kong-1"]; ok {
			apiPort = p
		}
		conn.Env["SUPABASE_URL"] = fmt.Sprintf("http://localhost:%d", apiPort)

		// Use default keys from .env.example (these are well-known demo keys)
		conn.Env["SUPABASE_ANON_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE"
		conn.Env["SUPABASE_SERVICE_ROLE_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q"
	}

	return &handlers.InfraService{
		ID:          stackID, // Use stack ID as service ID
		ProjectID:   projectID,
		ServiceType: serviceType,
		Name:        name,
		Status:      "ready",
		MachineID:   stackID, // For compose, machine ID is the stack ID
		Connection:  conn,
	}, nil
}

// provisionMachine provisions a single-container service (like Redis)
func (m *Manager) provisionMachine(ctx context.Context, projectID, serviceType, name string, def ServiceDefinition, env map[string]string, secrets *GeneratedEnv) (*handlers.InfraService, error) {
	// Generate unique names for machine and volume
	machinePrefix := fmt.Sprintf("infra-%s-%s", projectID[:8], serviceType)
	volumeName := fmt.Sprintf("vol-infra-%s-%s", projectID[:8], serviceType)

	// Create volume if needed
	var volumeID string
	if len(def.Volumes) > 0 {
		volDef := def.Volumes[0] // Use first volume definition
		volume, err := m.volumeManager.CreateVolume(volumeName, volDef.SizeGB, m.region)
		if err != nil {
			return nil, fmt.Errorf("failed to create volume: %w", err)
		}
		volumeID = volume.ID
	}

	// Build machine config using the handlers types
	machineConfig := handlers.MachineConfig{
		Image: def.Image,
		Guest: handlers.GuestConfig{
			CPUKind:  def.Guest.CPUKind,
			CPUs:     def.Guest.CPUs,
			MemoryMB: def.Guest.MemoryMB,
			GPUKind:  def.Guest.GPUKind,
		},
		Env: env,
	}

	// Add volume mount if we created a volume
	if volumeID != "" && len(def.Volumes) > 0 {
		machineConfig.Mounts = []handlers.Mount{
			{
				Volume: volumeID,
				Path:   def.Volumes[0].Path,
			},
		}
	}

	// Create the machine using the abstraction
	machine, err := m.machineManager.CreateMachine(machinePrefix, machineConfig)
	if err != nil {
		// Cleanup volume if machine creation failed
		if volumeID != "" {
			_ = m.volumeManager.DeleteVolume(volumeID)
		}
		return nil, fmt.Errorf("failed to create machine: %w", err)
	}

	// Wait for machine to be running
	if err := m.machineManager.WaitForState(machine.ID, "started", 2*time.Minute); err != nil {
		// Cleanup on failure
		_ = m.machineManager.DeleteMachine(machine.ID)
		if volumeID != "" {
			_ = m.volumeManager.DeleteVolume(volumeID)
		}
		return nil, fmt.Errorf("machine failed to start: %w", err)
	}

	// Get updated machine info with private IP
	machine, err = m.machineManager.GetMachine(machine.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get machine info: %w", err)
	}

	// Build connection details
	conn := &handlers.ConnectionDetails{
		Host: machine.PrivateIP,
		Env:  make(map[string]string),
	}

	// Set primary port if available
	if len(def.Ports) > 0 {
		conn.Port = def.Ports[0].InternalPort

		// Build connection URL based on service type
		switch serviceType {
		case "postgres":
			password := secrets.GeneratedPassword
			conn.Username = env["POSTGRES_USER"]
			conn.Password = password
			conn.URL = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s",
				conn.Username, password, machine.PrivateIP, conn.Port, env["POSTGRES_DB"])
			conn.Env["DATABASE_URL"] = conn.URL
		case "redis":
			conn.URL = fmt.Sprintf("redis://%s:%d", machine.PrivateIP, conn.Port)
			conn.Env["REDIS_URL"] = conn.URL
		}
	}

	// Add all ports to connection details
	if len(def.Ports) > 1 {
		conn.Ports = make(map[string]int)
		for _, p := range def.Ports {
			conn.Ports[p.Name] = p.InternalPort
		}
	}

	return &handlers.InfraService{
		ID:          machine.ID, // Use machine ID as service ID
		ProjectID:   projectID,
		ServiceType: serviceType,
		Name:        name,
		Status:      "ready",
		MachineID:   machine.ID,
		VolumeID:    volumeID,
		Connection:  conn,
	}, nil
}

// Get retrieves a specific infrastructure service
func (m *Manager) Get(ctx context.Context, serviceID string) (*handlers.InfraService, error) {
	// Try compose first
	if stack, err := m.composeManager.Status(ctx, serviceID); err == nil {
		return &handlers.InfraService{
			ID:        stack.ID,
			MachineID: stack.ID,
			Status:    stack.Status,
		}, nil
	}

	// Fall back to machine
	machine, err := m.machineManager.GetMachine(serviceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get machine: %w", err)
	}

	status := "ready"
	if machine.State == "stopped" {
		status = "stopped"
	} else if machine.State != "started" {
		status = "provisioning"
	}

	return &handlers.InfraService{
		ID:        machine.ID,
		MachineID: machine.ID,
		Status:    status,
	}, nil
}

// List retrieves all infrastructure services for a project
func (m *Manager) List(ctx context.Context, projectID string) ([]*handlers.InfraService, error) {
	// Infrastructure services are tracked in the database, not queried from the machine manager
	// This method returns nil - the handler uses the database store for listing
	return nil, nil
}

// Delete removes an infrastructure service
func (m *Manager) Delete(ctx context.Context, serviceID string) error {
	// Try compose first
	if err := m.composeManager.Down(ctx, serviceID); err == nil {
		return nil // Successfully deleted compose stack
	}

	// Fall back to machine deletion
	// Stop the machine first
	if err := m.machineManager.StopMachine(serviceID); err != nil {
		// Ignore errors, machine might already be stopped
	}

	// Wait for it to stop
	_ = m.machineManager.WaitForState(serviceID, "stopped", 30*time.Second)

	// Delete the machine
	if err := m.machineManager.DeleteMachine(serviceID); err != nil {
		return fmt.Errorf("failed to delete machine: %w", err)
	}

	// Note: Volume deletion would need the volume ID from the database
	// The handler should handle volume cleanup separately
	return nil
}

// Stop stops a running infrastructure service
func (m *Manager) Stop(ctx context.Context, serviceID string) error {
	// For compose stacks, we don't support stop/start - use delete instead
	// This is because docker compose doesn't have a clean "pause" semantic
	if err := m.machineManager.StopMachine(serviceID); err != nil {
		return fmt.Errorf("failed to stop machine: %w", err)
	}
	return m.machineManager.WaitForState(serviceID, "stopped", 30*time.Second)
}

// Start starts a stopped infrastructure service
func (m *Manager) Start(ctx context.Context, serviceID string) error {
	if err := m.machineManager.StartMachine(serviceID); err != nil {
		return fmt.Errorf("failed to start machine: %w", err)
	}
	return m.machineManager.WaitForState(serviceID, "started", 2*time.Minute)
}

// WaitForReady waits for a service to become ready
func (m *Manager) WaitForReady(ctx context.Context, serviceID string, timeout time.Duration) error {
	return m.machineManager.WaitForState(serviceID, "started", timeout)
}
