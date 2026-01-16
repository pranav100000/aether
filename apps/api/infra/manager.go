package infra

import (
	"context"
	"fmt"
	"time"

	"aether/apps/api/handlers"
)

// Manager provisions infrastructure services using the existing MachineManager and VolumeManager abstractions.
// This ensures consistent behavior between workspace VMs and infrastructure services.
type Manager struct {
	machineManager handlers.MachineManager
	volumeManager  handlers.VolumeManager
	registry       *Registry
	region         string
}

// NewManager creates a new infrastructure manager using the provided abstractions
func NewManager(
	machineManager handlers.MachineManager,
	volumeManager handlers.VolumeManager,
	registry *Registry,
	region string,
) *Manager {
	return &Manager{
		machineManager: machineManager,
		volumeManager:  volumeManager,
		registry:       registry,
		region:         region,
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
