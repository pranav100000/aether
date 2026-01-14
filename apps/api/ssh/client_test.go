package ssh

import (
	"fmt"
	"io"
	"net"
	"testing"
)

func TestAddressFormatting(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		port     int
		expected string
	}{
		{
			name:     "IPv4 address",
			host:     "192.168.1.1",
			port:     22,
			expected: "192.168.1.1:22",
		},
		{
			name:     "IPv4 address with custom port",
			host:     "10.0.0.1",
			port:     2222,
			expected: "10.0.0.1:2222",
		},
		{
			name:     "IPv6 address",
			host:     "fdaa:3c:cd70:a7b:4ea:53a6:6995:2",
			port:     22,
			expected: "[fdaa:3c:cd70:a7b:4ea:53a6:6995:2]:22",
		},
		{
			name:     "IPv6 address with custom port",
			host:     "fdaa:3c:cd70:a7b:4ea:53a6:6995:2",
			port:     2222,
			expected: "[fdaa:3c:cd70:a7b:4ea:53a6:6995:2]:2222",
		},
		{
			name:     "IPv6 loopback",
			host:     "::1",
			port:     22,
			expected: "[::1]:22",
		},
		{
			name:     "hostname",
			host:     "example.com",
			port:     22,
			expected: "example.com:22",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			addr := net.JoinHostPort(tt.host, fmt.Sprintf("%d", tt.port))
			if addr != tt.expected {
				t.Errorf("got %q, want %q", addr, tt.expected)
			}
		})
	}
}

func TestIsConnectionError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		{
			name:     "EOF error",
			err:      io.EOF,
			expected: true,
		},
		{
			name:     "net.OpError",
			err:      &net.OpError{Op: "dial", Err: io.EOF},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsConnectionError(tt.err)
			if result != tt.expected {
				t.Errorf("IsConnectionError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}
