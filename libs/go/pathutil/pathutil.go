package pathutil

import (
	"net"
	"path/filepath"
	"strings"
)

// JoinPath safely joins path components using filepath.Join
func JoinPath(base string, parts ...string) string {
	return filepath.Join(append([]string{base}, parts...)...)
}

// IsChildPath checks if child is under parent directory
func IsChildPath(child, parent string) bool {
	child = filepath.Clean(child)
	parent = filepath.Clean(parent)
	return strings.HasPrefix(child, parent+string(filepath.Separator))
}

// IsChildOrEqualPath checks if path is under or equal to parent
func IsChildOrEqualPath(path, parent string) bool {
	path = filepath.Clean(path)
	parent = filepath.Clean(parent)
	return path == parent || strings.HasPrefix(path, parent+string(filepath.Separator))
}

// SplitHostPort wraps net.SplitHostPort with fallback for missing port
func SplitHostPort(hostport string) (host, port string) {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return hostport, ""
	}
	return host, port
}

// GetHost extracts just the host from host:port string
func GetHost(hostport string) string {
	host, _ := SplitHostPort(hostport)
	return host
}

// LastPathComponent returns the last component of a path (like filepath.Base but for URL paths)
func LastPathComponent(path string) string {
	path = strings.TrimSuffix(path, "/")
	if idx := strings.LastIndex(path, "/"); idx != -1 {
		return path[idx+1:]
	}
	return path
}
