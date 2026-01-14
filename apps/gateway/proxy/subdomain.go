package proxy

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

var (
	ErrInvalidSubdomain = errors.New("invalid subdomain format")
	ErrInvalidPort      = errors.New("invalid port number")
	ErrInvalidProjectID = errors.New("invalid project ID prefix")
)

// SubdomainInfo holds parsed subdomain data
type SubdomainInfo struct {
	Port   int    // The port number (e.g., 5173)
	Prefix string // First 8 chars of project ID
	Token  string // Optional auth token (empty if not provided)
}

// validPrefixRegex matches exactly 8 alphanumeric characters (UUID prefix)
var validPrefixRegex = regexp.MustCompile(`^[a-f0-9]{8}$`)

// validTokenRegex matches alphanumeric tokens (1-64 chars)
var validTokenRegex = regexp.MustCompile(`^[a-zA-Z0-9]{1,64}$`)

// ParseSubdomain extracts port, project prefix, and optional token from host
//
// Supported formats:
//   - "{port}-{projectId}.{domain}" -> {Port: port, Prefix: projectId, Token: ""}
//   - "{port}-{projectId}-{token}.{domain}" -> {Port: port, Prefix: projectId, Token: token}
//
// Examples:
//   - "5173-abc12345.preview.aether.dev" -> {Port: 5173, Prefix: "abc12345", Token: ""}
//   - "5173-abc12345-secrettoken.preview.aether.dev" -> {Port: 5173, Prefix: "abc12345", Token: "secrettoken"}
//   - "3000-def67890.149.248.213.170.nip.io" -> {Port: 3000, Prefix: "def67890", Token: ""}
func ParseSubdomain(host, previewDomain string) (*SubdomainInfo, error) {
	// Remove port from host if present (e.g., "localhost:8080")
	if colonIdx := strings.LastIndex(host, ":"); colonIdx != -1 {
		// Check if it's an IPv6 address or just a port
		if !strings.Contains(host[colonIdx:], ".") {
			host = host[:colonIdx]
		}
	}

	// Check if host ends with the preview domain
	if !strings.HasSuffix(host, "."+previewDomain) && host != previewDomain {
		return nil, ErrInvalidSubdomain
	}

	// Extract subdomain (everything before .{previewDomain})
	subdomain := strings.TrimSuffix(host, "."+previewDomain)
	if subdomain == "" || subdomain == host {
		return nil, ErrInvalidSubdomain
	}

	// Parse subdomain: {port}-{prefix}[-{token}]
	parts := strings.SplitN(subdomain, "-", 3)
	if len(parts) < 2 {
		return nil, ErrInvalidSubdomain
	}

	// Parse port
	port, err := strconv.Atoi(parts[0])
	if err != nil || port < 1 || port > 65535 {
		return nil, ErrInvalidPort
	}

	// Validate project ID prefix (must be 8 hex chars)
	prefix := strings.ToLower(parts[1])
	if !validPrefixRegex.MatchString(prefix) {
		return nil, ErrInvalidProjectID
	}

	// Parse optional token
	var token string
	if len(parts) == 3 {
		token = parts[2]
		if !validTokenRegex.MatchString(token) {
			return nil, ErrInvalidSubdomain
		}
	}

	return &SubdomainInfo{
		Port:   port,
		Prefix: prefix,
		Token:  token,
	}, nil
}

// ExtractPreviewDomain attempts to extract the preview domain from a host
// This is useful when the preview domain might vary (nip.io vs custom domain)
//
// For nip.io: "5173-abc12345.149.248.213.170.nip.io" -> "149.248.213.170.nip.io"
// For custom: "5173-abc12345.preview.aether.dev" -> "preview.aether.dev"
func ExtractPreviewDomain(host string) string {
	// Remove port if present
	if colonIdx := strings.LastIndex(host, ":"); colonIdx != -1 {
		if !strings.Contains(host[colonIdx:], ".") {
			host = host[:colonIdx]
		}
	}

	// Find the first dot after the subdomain part
	// Subdomain format is {port}-{prefix}[-{token}]
	parts := strings.SplitN(host, ".", 2)
	if len(parts) < 2 {
		return ""
	}

	return parts[1]
}
