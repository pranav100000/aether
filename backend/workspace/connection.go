package workspace

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"aether/db"
	"aether/fly"
	"aether/handlers"
)

const DefaultSSHPort = 2222

// LocalConnectionResolver resolves connections for local Docker containers
type LocalConnectionResolver struct{}

func NewLocalConnectionResolver() *LocalConnectionResolver {
	return &LocalConnectionResolver{}
}

func (r *LocalConnectionResolver) GetConnectionInfo(project *db.Project) (*handlers.ConnectionInfo, error) {
	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		return nil, fmt.Errorf("project has no container")
	}

	// Query Docker for the port mapping
	// Container name is the machine ID (e.g., "local-<project-name>")
	containerName := *project.FlyMachineID
	port, err := getDockerPort(containerName, 2222)
	if err != nil {
		return nil, fmt.Errorf("failed to get container port: %w", err)
	}

	// Use host.docker.internal when backend runs in Docker (sibling container setup)
	// This resolves to the Docker host where the container ports are published
	host := getDockerHost()

	return &handlers.ConnectionInfo{
		Host: host,
		Port: port,
	}, nil
}

// getDockerHost returns the appropriate host to reach Docker containers
// When running inside Docker, use host.docker.internal to reach the Docker host
// When running on the host directly, use 127.0.0.1
func getDockerHost() string {
	// Check if we're running inside Docker by looking for /.dockerenv
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "host.docker.internal"
	}
	// Also check the cgroup (works on Linux)
	if data, err := os.ReadFile("/proc/1/cgroup"); err == nil {
		if strings.Contains(string(data), "docker") {
			return "host.docker.internal"
		}
	}
	return "127.0.0.1"
}

// getDockerPort queries Docker for the host port mapped to a container port
func getDockerPort(containerName string, containerPort int) (int, error) {
	cmd := exec.Command("docker", "port", containerName, strconv.Itoa(containerPort))
	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("docker port command failed: %w", err)
	}

	// Output format: "0.0.0.0:2222" or ":::2222" (IPv6)
	// We need to extract the port number after the last ":"
	result := strings.TrimSpace(string(output))
	if result == "" {
		return 0, fmt.Errorf("no port mapping found for container %s port %d", containerName, containerPort)
	}

	// Handle multiple lines (IPv4 and IPv6)
	lines := strings.Split(result, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Extract port from "0.0.0.0:2222" or "[::]:2222"
		lastColon := strings.LastIndex(line, ":")
		if lastColon == -1 {
			continue
		}
		portStr := line[lastColon+1:]
		port, err := strconv.Atoi(portStr)
		if err != nil {
			continue
		}
		return port, nil
	}

	return 0, fmt.Errorf("could not parse port from docker output: %s", result)
}

// FlyConnectionResolver resolves connections for Fly.io VMs
type FlyConnectionResolver struct {
	flyClient *fly.Client
}

func NewFlyConnectionResolver(flyClient *fly.Client) *FlyConnectionResolver {
	return &FlyConnectionResolver{flyClient: flyClient}
}

func (r *FlyConnectionResolver) GetConnectionInfo(project *db.Project) (*handlers.ConnectionInfo, error) {
	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		return nil, fmt.Errorf("project has no VM")
	}

	machine, err := r.flyClient.GetMachine(*project.FlyMachineID)
	if err != nil {
		return nil, fmt.Errorf("failed to get machine: %w", err)
	}

	if machine.State != "started" {
		return nil, fmt.Errorf("VM is not running (state: %s)", machine.State)
	}

	if machine.PrivateIP == "" {
		return nil, fmt.Errorf("machine has no IP address")
	}

	return &handlers.ConnectionInfo{
		Host: machine.PrivateIP,
		Port: DefaultSSHPort,
	}, nil
}
