package local

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"

	"aether/apps/api/handlers"
	"aether/apps/api/infra"
)

// InfraManager implements handlers.InfraServiceManager for local development using Docker.
// It creates Docker containers for infrastructure services.
type InfraManager struct {
	mu       sync.RWMutex
	services map[string]*infraServiceState
	registry *infra.Registry
}

type infraServiceState struct {
	ID          string
	ContainerID string
	State       string
	ProjectID   string
	ServiceType string
}

// NewInfraManager creates a new local infrastructure manager
func NewInfraManager(registry *infra.Registry) *InfraManager {
	return &InfraManager{
		services: make(map[string]*infraServiceState),
		registry: registry,
	}
}

// Provision creates a new infrastructure service using Docker
func (m *InfraManager) Provision(ctx context.Context, projectID string, serviceType string, name string, config map[string]interface{}) (*handlers.InfraService, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

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

	// Generate container name
	containerName := fmt.Sprintf("infra-%s-%s", projectID[:8], serviceType)

	// Clean up any existing container with the same name
	cleanupCmd := exec.Command("docker", "rm", "-f", containerName)
	_ = cleanupCmd.Run() // Ignore errors - container may not exist

	// Build docker run arguments
	args := []string{
		"run", "-d",
		"--name", containerName,
		"--network", "aether",
	}

	// Expose ports
	for _, port := range def.Ports {
		// Map internal port to same port on host (within the Docker network)
		args = append(args, "-p", fmt.Sprintf("0:%d", port.InternalPort))
	}

	// Add environment variables
	for k, v := range env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}

	// Add image
	args = append(args, def.Image)

	log.Printf("[LOCAL INFRA] Creating Docker container: docker %s", strings.Join(args, " "))
	cmd := exec.Command("docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker container: %w\nOutput: %s", err, string(output))
	}

	// Parse container ID from output
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	containerID := lines[len(lines)-1]
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Wait for container to be running
	for i := 0; i < 30; i++ {
		inspectCmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", containerName)
		out, err := inspectCmd.Output()
		if err == nil && strings.TrimSpace(string(out)) == "true" {
			break
		}
		time.Sleep(1 * time.Second)
	}

	// Get container IP address on the aether network
	ipCmd := exec.Command("docker", "inspect", "-f", "{{.NetworkSettings.Networks.aether.IPAddress}}", containerName)
	ipOutput, err := ipCmd.Output()
	if err != nil {
		log.Printf("[LOCAL INFRA] Failed to get container IP: %v", err)
	}
	containerIP := strings.TrimSpace(string(ipOutput))
	if containerIP == "" {
		// Fallback to container name for DNS resolution within Docker network
		containerIP = containerName
	}

	// Store state
	serviceID := containerName
	m.services[serviceID] = &infraServiceState{
		ID:          serviceID,
		ContainerID: containerID,
		State:       "running",
		ProjectID:   projectID,
		ServiceType: serviceType,
	}

	// Build connection details
	conn := &handlers.ConnectionDetails{
		Host: containerIP,
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
				conn.Username, password, containerIP, conn.Port, env["POSTGRES_DB"])
			conn.Env["DATABASE_URL"] = conn.URL
		case "redis":
			conn.URL = fmt.Sprintf("redis://%s:%d", containerIP, conn.Port)
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

	log.Printf("[LOCAL INFRA] Service %s provisioned: host=%s port=%d", serviceType, containerIP, conn.Port)

	return &handlers.InfraService{
		ID:          serviceID,
		ProjectID:   projectID,
		ServiceType: serviceType,
		Name:        name,
		Status:      "ready",
		MachineID:   containerID,
		VolumeID:    "",
		Connection:  conn,
	}, nil
}

// Get retrieves a specific infrastructure service
func (m *InfraManager) Get(ctx context.Context, serviceID string) (*handlers.InfraService, error) {
	m.mu.RLock()
	state, ok := m.services[serviceID]
	m.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("service not found: %s", serviceID)
	}

	// Check container state
	inspectCmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", serviceID)
	out, err := inspectCmd.Output()
	status := "stopped"
	if err == nil && strings.TrimSpace(string(out)) == "true" {
		status = "ready"
	}

	return &handlers.InfraService{
		ID:          serviceID,
		ProjectID:   state.ProjectID,
		ServiceType: state.ServiceType,
		MachineID:   state.ContainerID,
		Status:      status,
	}, nil
}

// List retrieves all infrastructure services for a project
func (m *InfraManager) List(ctx context.Context, projectID string) ([]*handlers.InfraService, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var services []*handlers.InfraService
	for _, state := range m.services {
		if state.ProjectID == projectID {
			services = append(services, &handlers.InfraService{
				ID:          state.ID,
				ProjectID:   state.ProjectID,
				ServiceType: state.ServiceType,
				MachineID:   state.ContainerID,
				Status:      "ready", // Simplified - would need to check actual state
			})
		}
	}
	return services, nil
}

// Delete removes an infrastructure service
func (m *InfraManager) Delete(ctx context.Context, serviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop and remove the container
	stopCmd := exec.Command("docker", "stop", serviceID)
	_ = stopCmd.Run()

	rmCmd := exec.Command("docker", "rm", "-f", serviceID)
	if err := rmCmd.Run(); err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	delete(m.services, serviceID)
	log.Printf("[LOCAL INFRA] Service %s deleted", serviceID)
	return nil
}

// Stop stops a running infrastructure service
func (m *InfraManager) Stop(ctx context.Context, serviceID string) error {
	cmd := exec.Command("docker", "stop", serviceID)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}
	return nil
}

// Start starts a stopped infrastructure service
func (m *InfraManager) Start(ctx context.Context, serviceID string) error {
	cmd := exec.Command("docker", "start", serviceID)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}
	return nil
}

// WaitForReady waits for a service to become ready
func (m *InfraManager) WaitForReady(ctx context.Context, serviceID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		inspectCmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", serviceID)
		out, err := inspectCmd.Output()
		if err == nil && strings.TrimSpace(string(out)) == "true" {
			return nil
		}
		time.Sleep(1 * time.Second)
	}
	return fmt.Errorf("timeout waiting for service %s to be ready", serviceID)
}
