package fly

import (
	"context"
	"fmt"
	"time"

	"aether/apps/api/handlers"
	"aether/apps/api/infra"
)

// InfraManager provisions infrastructure services on Fly.io
type InfraManager struct {
	client   *Client
	registry *infra.Registry
}

// NewInfraManager creates a new Fly.io infrastructure manager
func NewInfraManager(client *Client, registry *infra.Registry) *InfraManager {
	return &InfraManager{
		client:   client,
		registry: registry,
	}
}

// Provision creates a new infrastructure service on Fly.io
func (m *InfraManager) Provision(ctx context.Context, projectID string, serviceType string, name string, config map[string]interface{}) (*handlers.InfraService, error) {
	// Get service definition
	def, ok := m.registry.Get(serviceType)
	if !ok {
		return nil, fmt.Errorf("unknown service type: %s", serviceType)
	}

	// Generate secrets for the service
	secrets, err := infra.GenerateSecrets()
	if err != nil {
		return nil, fmt.Errorf("failed to generate secrets: %w", err)
	}

	// Build environment variables from template
	env := infra.BuildEnv(def.EnvTemplate, secrets)

	// Generate unique names for machine and volume
	machinePrefix := fmt.Sprintf("infra-%s-%s", projectID[:8], serviceType)
	volumeName := fmt.Sprintf("vol-%s-%s", projectID[:8], serviceType)

	// Create volume if needed
	var volumeID string
	if len(def.Volumes) > 0 {
		volDef := def.Volumes[0] // Use first volume definition
		volume, err := m.client.CreateVolume(volumeName, volDef.SizeGB, m.client.GetRegion())
		if err != nil {
			return nil, fmt.Errorf("failed to create volume: %w", err)
		}
		volumeID = volume.ID
	}

	// Build machine config
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

	// Create the machine
	machine, err := m.client.CreateMachine(machinePrefix, machineConfig)
	if err != nil {
		// Cleanup volume if machine creation failed
		if volumeID != "" {
			_ = m.client.DeleteVolume(volumeID)
		}
		return nil, fmt.Errorf("failed to create machine: %w", err)
	}

	// Wait for machine to be running
	if err := m.client.WaitForState(machine.ID, "started", 2*time.Minute); err != nil {
		// Cleanup on failure
		_ = m.client.DeleteMachine(machine.ID)
		if volumeID != "" {
			_ = m.client.DeleteVolume(volumeID)
		}
		return nil, fmt.Errorf("machine failed to start: %w", err)
	}

	// Get updated machine info with private IP
	machine, err = m.client.GetMachine(machine.ID)
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
		case "supabase", "postgres":
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
		ID:          machine.ID, // Use machine ID as service ID for now
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
func (m *InfraManager) Get(ctx context.Context, serviceID string) (*handlers.InfraService, error) {
	machine, err := m.client.GetMachine(serviceID)
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
func (m *InfraManager) List(ctx context.Context, projectID string) ([]*handlers.InfraService, error) {
	// Not implemented - would need to track services in database
	return nil, nil
}

// Delete removes an infrastructure service
func (m *InfraManager) Delete(ctx context.Context, serviceID string) error {
	// Stop the machine first
	if err := m.client.StopMachine(serviceID); err != nil {
		// Ignore errors, machine might already be stopped
	}

	// Wait for it to stop
	_ = m.client.WaitForState(serviceID, "stopped", 30*time.Second)

	// Delete the machine
	if err := m.client.DeleteMachine(serviceID); err != nil {
		return fmt.Errorf("failed to delete machine: %w", err)
	}

	// Note: Volume deletion would need to be handled separately
	// The volume ID would need to be tracked in the database
	return nil
}

// Stop stops a running infrastructure service
func (m *InfraManager) Stop(ctx context.Context, serviceID string) error {
	if err := m.client.StopMachine(serviceID); err != nil {
		return fmt.Errorf("failed to stop machine: %w", err)
	}
	return m.client.WaitForState(serviceID, "stopped", 30*time.Second)
}

// Start starts a stopped infrastructure service
func (m *InfraManager) Start(ctx context.Context, serviceID string) error {
	if err := m.client.StartMachine(serviceID); err != nil {
		return fmt.Errorf("failed to start machine: %w", err)
	}
	return m.client.WaitForState(serviceID, "started", 2*time.Minute)
}

// WaitForReady waits for a service to become ready
func (m *InfraManager) WaitForReady(ctx context.Context, serviceID string, timeout time.Duration) error {
	return m.client.WaitForState(serviceID, "started", timeout)
}
