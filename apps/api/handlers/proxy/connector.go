package proxy

import (
	"context"
	"time"
)

// ProxyConnector is a transport-agnostic interface for communicating with
// a VM's agent service. It handles raw JSON bytes without knowledge of
// message types - allowing the same transport to carry agent messages,
// file updates, and any future message types.
type ProxyConnector interface {
	// Connect establishes connection to the VM's agent service
	Connect(ctx context.Context, config ConnectorConfig) error

	// Send transmits raw JSON bytes to the VM
	Send(ctx context.Context, data []byte) error

	// Receive returns a channel of raw JSON messages from the VM
	Receive() <-chan []byte

	// Close terminates the connection
	Close() error

	// Done signals when the connection terminates
	Done() <-chan struct{}
}

// ConnectorConfig contains configuration for establishing a connection
type ConnectorConfig struct {
	// Host is the VM's hostname or IP address
	Host string

	// Port is the connection port (e.g., 2222 for SSH, 3001 for WebSocket)
	Port int

	// Endpoint is the WebSocket endpoint path (e.g., "/workspace" or "/agent/claude")
	// If empty and AgentType is set, defaults to "/agent/{AgentType}"
	Endpoint string

	// AgentType specifies which agent to connect to (claude, codex, etc.)
	// Used for WebSocket path: /agent/{AgentType} when Endpoint is not set
	AgentType string

	// Environment contains environment variables to pass to the agent
	// (e.g., API keys)
	Environment map[string]string

	// ConnectTimeout is the maximum time to wait for connection
	ConnectTimeout time.Duration
}
