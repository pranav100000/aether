package handlers

import (
	"net/http"
	"strings"
)

// ExtractTokenFromRequest extracts a bearer token from an HTTP request
// It checks both the Authorization header and WebSocket subprotocol
func ExtractTokenFromRequest(r *http.Request) string {
	// Try Authorization header first
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
			return parts[1]
		}
	}

	// Try WebSocket subprotocol
	// Client sends: Sec-WebSocket-Protocol: bearer, <token>
	protocols := r.Header.Get("Sec-WebSocket-Protocol")
	if protocols != "" {
		parts := strings.Split(protocols, ", ")
		for i, p := range parts {
			if p == "bearer" && i+1 < len(parts) {
				return parts[i+1]
			}
		}
	}

	return ""
}
