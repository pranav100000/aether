package local

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"aether/apps/api/handlers"
)

// ComposeManager manages docker compose stacks locally
type ComposeManager struct {
	// baseDir is the repo root directory (for resolving relative compose paths)
	// When running inside a container (Docker-in-Docker), this is the container path
	baseDir string
	// hostBaseDir is the host path equivalent of baseDir (for DinD volume mounts)
	// If empty, baseDir is assumed to be a host path
	hostBaseDir string
	// stacks tracks running stacks by ID
	stacks map[string]*handlers.ComposeStack
}

// NewComposeManager creates a new local compose manager
// hostBaseDir should be set when running inside a container to the host path equivalent
func NewComposeManager(baseDir string, hostBaseDir string) *ComposeManager {
	// Normalize baseDir to handle paths like "/app/apps/api/../.."
	normalizedBaseDir := filepath.Clean(baseDir)
	return &ComposeManager{
		baseDir:     normalizedBaseDir,
		hostBaseDir: hostBaseDir,
		stacks:      make(map[string]*handlers.ComposeStack),
	}
}

// getHostPath converts a container path to a host path (for Docker-in-Docker)
func (m *ComposeManager) getHostPath(containerPath string) string {
	if m.hostBaseDir == "" {
		return containerPath // Not running in DinD, paths are already host paths
	}
	// Replace baseDir prefix with hostBaseDir
	if strings.HasPrefix(containerPath, m.baseDir) {
		return filepath.Join(m.hostBaseDir, strings.TrimPrefix(containerPath, m.baseDir))
	}
	return containerPath
}

// Up starts a compose stack from the given directory
func (m *ComposeManager) Up(ctx context.Context, stackID string, composeDir string, env map[string]string) (*handlers.ComposeStack, error) {
	// Resolve the compose directory relative to base dir
	fullPath := composeDir
	if !filepath.IsAbs(composeDir) {
		fullPath = filepath.Join(m.baseDir, composeDir)
	}

	// Check if docker-compose.yml exists
	composePath := filepath.Join(fullPath, "docker-compose.yml")
	if _, err := os.Stat(composePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("docker-compose.yml not found at %s", composePath)
	}

	// Create .env file from provided env vars
	if len(env) > 0 {
		if err := m.writeEnvFile(fullPath, env); err != nil {
			return nil, fmt.Errorf("failed to write .env file: %w", err)
		}
	} else {
		// Copy .env.example to .env if .env doesn't exist
		envPath := filepath.Join(fullPath, ".env")
		examplePath := filepath.Join(fullPath, ".env.example")
		if _, err := os.Stat(envPath); os.IsNotExist(err) {
			if _, err := os.Stat(examplePath); err == nil {
				if err := copyFile(examplePath, envPath); err != nil {
					return nil, fmt.Errorf("failed to copy .env.example: %w", err)
				}
			}
		}
	}

	// Get host path for Docker-in-Docker volume mounting
	hostPath := m.getHostPath(fullPath)

	// Run docker compose up with project name
	// Use -f to specify compose file from container path (so compose can read it)
	// Use --project-directory to specify host path (so volume mounts use host paths)
	// Use --env-file to explicitly specify the env file path
	// Don't use --wait as some services may be slow to become healthy
	composeFile := filepath.Join(fullPath, "docker-compose.yml")
	envFile := filepath.Join(fullPath, ".env")
	cmd := exec.CommandContext(ctx, "docker", "compose", "-f", composeFile, "--project-directory", hostPath, "--env-file", envFile, "-p", stackID, "up", "-d")
	cmd.Dir = fullPath

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("docker compose up failed: %w\nstderr: %s", err, stderr.String())
	}

	// Get the running services
	services, err := m.getServices(ctx, stackID, composeFile, envFile, hostPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get services: %w", err)
	}

	// Get exposed ports
	ports, err := m.getPorts(ctx, stackID, composeFile, envFile, hostPath)
	if err != nil {
		// Non-fatal, just log
		ports = make(map[string]int)
	}

	stack := &handlers.ComposeStack{
		ID:        stackID,
		Name:      stackID,
		Status:    "running",
		Services:  services,
		Ports:     ports,
		Env:       env,
		Directory: hostPath, // Store host path for subsequent operations
	}

	m.stacks[stackID] = stack
	return stack, nil
}

// Down stops and removes a compose stack
func (m *ComposeManager) Down(ctx context.Context, stackID string) error {
	stack, ok := m.stacks[stackID]
	if !ok {
		return fmt.Errorf("stack %s not found", stackID)
	}

	cmd := exec.CommandContext(ctx, "docker", "compose", "--project-directory", stack.Directory, "-p", stackID, "down", "-v", "--remove-orphans")

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker compose down failed: %w\nstderr: %s", err, stderr.String())
	}

	delete(m.stacks, stackID)
	return nil
}

// Status gets the current status of a compose stack
func (m *ComposeManager) Status(ctx context.Context, stackID string) (*handlers.ComposeStack, error) {
	stack, ok := m.stacks[stackID]
	if !ok {
		return nil, fmt.Errorf("stack %s not found", stackID)
	}

	// Check if containers are actually running
	cmd := exec.CommandContext(ctx, "docker", "compose", "--project-directory", stack.Directory, "-p", stackID, "ps", "--format", "{{.State}}")

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		stack.Status = "error"
		return stack, nil
	}

	output := strings.TrimSpace(stdout.String())
	if output == "" {
		stack.Status = "stopped"
	} else if strings.Contains(output, "running") {
		stack.Status = "running"
	} else {
		stack.Status = "partial"
	}

	return stack, nil
}

// Logs retrieves logs from a compose stack
func (m *ComposeManager) Logs(ctx context.Context, stackID string, service string) (string, error) {
	stack, ok := m.stacks[stackID]
	if !ok {
		return "", fmt.Errorf("stack %s not found", stackID)
	}

	args := []string{"compose", "--project-directory", stack.Directory, "-p", stackID, "logs", "--tail", "100"}
	if service != "" {
		args = append(args, service)
	}

	cmd := exec.CommandContext(ctx, "docker", args...)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to get logs: %w", err)
	}

	return stdout.String(), nil
}

// WaitForHealthy waits for all services in the stack to be healthy
func (m *ComposeManager) WaitForHealthy(ctx context.Context, stackID string, timeout time.Duration) error {
	stack, ok := m.stacks[stackID]
	if !ok {
		return fmt.Errorf("stack %s not found", stackID)
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cmd := exec.CommandContext(ctx, "docker", "compose", "--project-directory", stack.Directory, "-p", stackID, "ps", "--format", "{{.Health}}")

		var stdout bytes.Buffer
		cmd.Stdout = &stdout

		if err := cmd.Run(); err != nil {
			time.Sleep(2 * time.Second)
			continue
		}

		output := strings.TrimSpace(stdout.String())
		lines := strings.Split(output, "\n")

		allHealthy := true
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" && line != "healthy" {
				allHealthy = false
				break
			}
		}

		if allHealthy {
			return nil
		}

		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("timeout waiting for stack %s to be healthy", stackID)
}

// writeEnvFile writes environment variables to a .env file
func (m *ComposeManager) writeEnvFile(dir string, env map[string]string) error {
	envPath := filepath.Join(dir, ".env")

	// Read existing .env.example to preserve defaults
	examplePath := filepath.Join(dir, ".env.example")
	var existingEnv map[string]string
	if data, err := os.ReadFile(examplePath); err == nil {
		existingEnv = parseEnvFile(string(data))
	} else {
		existingEnv = make(map[string]string)
	}

	// Merge: existing defaults + provided overrides
	for k, v := range env {
		existingEnv[k] = v
	}

	// Write to .env
	var buf bytes.Buffer
	for k, v := range existingEnv {
		buf.WriteString(fmt.Sprintf("%s=%s\n", k, v))
	}

	return os.WriteFile(envPath, buf.Bytes(), 0600)
}

// getServices returns the list of services in the stack
func (m *ComposeManager) getServices(ctx context.Context, stackID string, composeFile string, envFile string, hostDir string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "docker", "compose", "-f", composeFile, "--env-file", envFile, "--project-directory", hostDir, "-p", stackID, "config", "--services")

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	var services []string
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			services = append(services, line)
		}
	}
	return services, nil
}

// getPorts returns exposed ports by service name
func (m *ComposeManager) getPorts(ctx context.Context, stackID string, composeFile string, envFile string, hostDir string) (map[string]int, error) {
	cmd := exec.CommandContext(ctx, "docker", "compose", "-f", composeFile, "--env-file", envFile, "--project-directory", hostDir, "-p", stackID, "ps", "--format", "{{.Name}}:{{.Ports}}")

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	ports := make(map[string]int)
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	for _, line := range lines {
		// Parse format like "supabase-kong-1:0.0.0.0:8000->8000/tcp"
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			name := parts[0]
			// Extract first port mapping
			portParts := strings.Split(parts[1], "->")
			if len(portParts) >= 1 {
				hostPort := strings.TrimPrefix(portParts[0], "0.0.0.0:")
				if p := strings.Split(hostPort, ":"); len(p) > 0 {
					var port int
					fmt.Sscanf(p[len(p)-1], "%d", &port)
					if port > 0 {
						ports[name] = port
					}
				}
			}
		}
	}
	return ports, nil
}

// parseEnvFile parses a .env file into a map
func parseEnvFile(content string) map[string]string {
	env := make(map[string]string)
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			env[parts[0]] = parts[1]
		}
	}
	return env
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}
