package local

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"

	"aether/apps/api/config"
	"aether/apps/api/handlers"
)

// MachineManager implements handlers.MachineManager for local development using Docker.
// It creates Docker containers from the same base image used in production.
type MachineManager struct {
	mu       sync.RWMutex
	machines map[string]*machineState
}

type machineState struct {
	ID          string
	ContainerID string
	State       string
}

func NewMachineManager() *MachineManager {
	return &MachineManager{
		machines: make(map[string]*machineState),
	}
}

func (m *MachineManager) CreateMachine(name string, cfg handlers.MachineConfig) (*handlers.Machine, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := "local-" + name

	// Clean up any existing container with the same name
	cleanupCmd := exec.Command("docker", "rm", "-f", id)
	cleanupCmd.Run() // Ignore errors - container may not exist

	// Get project directory for volume mount
	projectDir := config.GetLocalProjectDir()

	// Determine image to use
	image := config.Get().LocalBaseImage
	if cfg.Image != "" {
		image = cfg.Image
	}
	if image == "" {
		return nil, fmt.Errorf("no base image configured for local mode - set LOCAL_BASE_IMAGE env var")
	}

	// Create and start Docker container
	// Use -p 0:PORT to let Docker auto-assign available host ports for SSH and WebSocket
	// Join the 'aether' network so gateway can reach this container
	args := []string{
		"run", "-d",
		"--name", id,
		"--network", "aether",
		"-p", "0:2222",
		"-p", "0:3001",
	}

	// Mount volumes from config (each project has its own volume directory)
	if len(cfg.Mounts) > 0 {
		for _, mount := range cfg.Mounts {
			// Volume ID is "local-vol-{name}", extract the name to get the directory
			volumeName := strings.TrimPrefix(mount.Volume, "local-vol-")
			volumeDir := fmt.Sprintf("%s/%s", projectDir, volumeName)
			args = append(args, "-v", fmt.Sprintf("%s:%s", volumeDir, mount.Path))
			log.Printf("[LOCAL] Mounting volume %s -> %s", volumeDir, mount.Path)
		}
	} else {
		// Fallback: mount base project directory (for backwards compatibility)
		args = append(args, "-v", fmt.Sprintf("%s:/home/coder/workspace", projectDir))
	}

	// Mount workspace-service for local development (agent CLI)
	if wsDir := config.Get().LocalWorkspaceServiceDir; wsDir != "" {
		args = append(args, "-v", fmt.Sprintf("%s:/opt/workspace-service", wsDir))
	}

	// Add environment variables from config
	for k, v := range cfg.Env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}

	args = append(args, image)

	log.Printf("[LOCAL] Creating Docker container: docker %s", strings.Join(args, " "))
	cmd := exec.Command("docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker container: %w\nOutput: %s", err, string(output))
	}

	// Parse container ID from output (may have warnings before the ID)
	containerID := parseContainerID(string(output))
	log.Printf("[LOCAL] Created container %s (ID: %s)", id, containerID)

	state := &machineState{
		ID:          id,
		ContainerID: containerID,
		State:       "started",
	}
	m.machines[id] = state

	return &handlers.Machine{
		ID:        id,
		Name:      name,
		State:     "started",
		PrivateIP: "127.0.0.1",
		Region:    "local",
		CreatedAt: time.Now().Format(time.RFC3339),
	}, nil
}

// parseContainerID extracts the container ID from docker run output
// The output may contain warnings before the actual container ID
func parseContainerID(output string) string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	// The container ID is typically a 64-char hex string on its own line
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		// Container IDs are 64 hex characters
		if len(line) == 64 && isHexString(line) {
			return line
		}
		// Short IDs are 12 hex characters
		if len(line) == 12 && isHexString(line) {
			return line
		}
	}
	// Fallback: return last non-empty line
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return strings.TrimSpace(output)
}

func isHexString(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func (m *MachineManager) GetMachine(machineID string) (*handlers.Machine, error) {
	m.mu.RLock()
	state, ok := m.machines[machineID]
	m.mu.RUnlock()

	if ok {
		// Found in memory - use cached container ID
		privateIP := getContainerIP(state.ContainerID)
		if privateIP == "" {
			privateIP = "127.0.0.1"
		}
		return &handlers.Machine{
			ID:        state.ID,
			Name:      state.ID,
			State:     state.State,
			PrivateIP: privateIP,
			Region:    "local",
		}, nil
	}

	// Not in memory - try to look up container directly via docker inspect
	// This allows the gateway to find containers created by the backend
	privateIP := getContainerIP(machineID)
	if privateIP == "" {
		return nil, fmt.Errorf("machine %s not found (no container with that name/ID)", machineID)
	}

	// Container exists - return its info
	containerState := getContainerState(machineID)
	return &handlers.Machine{
		ID:        machineID,
		Name:      machineID,
		State:     containerState,
		PrivateIP: privateIP,
		Region:    "local",
	}, nil
}

// getContainerState returns the state of a Docker container (running, exited, etc.)
func getContainerState(containerID string) string {
	cmd := exec.Command("docker", "inspect",
		"--format", "{{.State.Status}}",
		containerID)
	output, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	status := strings.TrimSpace(string(output))
	// Map Docker status to our state names
	if status == "running" {
		return "started"
	}
	return status
}

// getContainerIP returns the Docker network IP of a container on the aether network
func getContainerIP(containerID string) string {
	cmd := exec.Command("docker", "inspect",
		"--format", "{{.NetworkSettings.Networks.aether.IPAddress}}",
		containerID)
	output, err := cmd.Output()
	if err != nil {
		log.Printf("[LOCAL] Failed to get container IP for %s: %v", containerID, err)
		return ""
	}
	return strings.TrimSpace(string(output))
}

func (m *MachineManager) StartMachine(machineID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.machines[machineID]
	if !ok {
		return fmt.Errorf("machine %s not found", machineID)
	}

	cmd := exec.Command("docker", "start", state.ContainerID)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to start container: %w\nOutput: %s", err, string(output))
	}

	state.State = "started"
	log.Printf("[LOCAL] Started container %s", machineID)
	return nil
}

func (m *MachineManager) StopMachine(machineID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.machines[machineID]
	if !ok {
		return fmt.Errorf("machine %s not found", machineID)
	}

	cmd := exec.Command("docker", "stop", state.ContainerID)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to stop container: %w\nOutput: %s", err, string(output))
	}

	state.State = "stopped"
	log.Printf("[LOCAL] Stopped container %s", machineID)
	return nil
}

func (m *MachineManager) DeleteMachine(machineID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.machines[machineID]
	if !ok {
		return fmt.Errorf("machine %s not found in local manager", machineID)
	}

	cmd := exec.Command("docker", "rm", "-f", state.ContainerID)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to delete container: %w\nOutput: %s", err, string(output))
	}

	delete(m.machines, machineID)
	log.Printf("[LOCAL] Deleted container %s", machineID)
	return nil
}

func (m *MachineManager) WaitForState(machineID string, targetState string, timeout time.Duration) error {
	// For Docker containers, state changes are nearly instant
	// Just verify the container is in expected state
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		m.mu.RLock()
		state, ok := m.machines[machineID]
		m.mu.RUnlock()

		if !ok {
			return fmt.Errorf("machine %s not found", machineID)
		}

		if state.State == targetState || (targetState == "started" && state.State == "started") {
			return nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("timeout waiting for machine %s to reach state %s", machineID, targetState)
}
