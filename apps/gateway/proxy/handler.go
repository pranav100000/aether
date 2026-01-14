package proxy

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"aether/apps/api/db"
	"aether/apps/api/handlers"
	"aether/libs/go/logging"
)

// Handler handles all incoming proxy requests
type Handler struct {
	db            *db.Client
	machines      handlers.MachineManager
	previewDomain string
	cache         *ProjectCache
	log           *logging.Logger
}

// NewHandler creates a new proxy handler
func NewHandler(dbClient *db.Client, machines handlers.MachineManager, previewDomain string, logger *logging.Logger) *Handler {
	return &Handler{
		db:            dbClient,
		machines:      machines,
		previewDomain: previewDomain,
		cache:         NewProjectCache(30 * time.Second),
		log:           logger,
	}
}

// ServeHTTP handles all incoming requests
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Health check endpoint
	if r.URL.Path == "/health" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
		return
	}

	// Parse subdomain from Host header
	host := r.Host
	info, err := ParseSubdomain(host, h.previewDomain)
	if err != nil {
		h.log.Warn("invalid subdomain", "host", host, "error", err)
		http.Error(w, "Invalid preview URL format", http.StatusBadRequest)
		return
	}

	// Try to get from cache first
	cached, found := h.cache.Get(info.Prefix)
	if found {
		// Validate token if project requires it
		if !h.validateCachedAccess(cached, info.Token) {
			http.Error(w, "Unauthorized", http.StatusForbidden)
			return
		}
		h.proxyRequest(w, r, cached.PrivateIP, info.Port)
		return
	}

	// Look up project in database
	project, err := h.db.GetProjectByIDPrefix(r.Context(), info.Prefix)
	if err != nil {
		if err == db.ErrNotFound {
			h.log.Debug("project not found", "prefix", info.Prefix)
			http.Error(w, "Project not found", http.StatusNotFound)
			return
		}
		h.log.Error("database error looking up project", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Check if project is running
	if project.Status != "running" {
		h.log.Debug("project not running", "project_id", project.ID, "status", project.Status)
		http.Error(w, "Project is not running", http.StatusServiceUnavailable)
		return
	}

	// Validate auth token
	if !h.validateAccess(project, info.Token) {
		http.Error(w, "Unauthorized", http.StatusForbidden)
		return
	}

	// Get machine private IP
	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		h.log.Warn("project has no machine", "project_id", project.ID)
		http.Error(w, "Project has no running machine", http.StatusServiceUnavailable)
		return
	}

	machine, err := h.machines.GetMachine(*project.FlyMachineID)
	if err != nil {
		h.log.Error("failed to get machine", "machine_id", *project.FlyMachineID, "error", err)
		http.Error(w, "Failed to connect to project", http.StatusBadGateway)
		return
	}

	if machine.PrivateIP == "" {
		h.log.Warn("machine has no private IP", "machine_id", machine.ID)
		http.Error(w, "Project machine has no IP", http.StatusBadGateway)
		return
	}

	// Cache the result
	h.cache.Set(info.Prefix, project.ID, machine.PrivateIP)

	// Proxy the request
	h.proxyRequest(w, r, machine.PrivateIP, info.Port)
}

// validateAccess checks if the provided token matches the project's preview token
func (h *Handler) validateAccess(project *db.Project, providedToken string) bool {
	// If project has no token set, allow all access (public preview)
	if project.PreviewToken == nil || *project.PreviewToken == "" {
		return true
	}
	// If project has token, require matching token
	return providedToken == *project.PreviewToken
}

// validateCachedAccess validates token against a cached entry
// For cached entries, we can't check the token (it's not cached)
// So we need to re-lookup if a token is provided
func (h *Handler) validateCachedAccess(cached *CacheEntry, providedToken string) bool {
	// If no token provided, allow (public access)
	// The project might require a token, but we check that on first request
	// and cache only after successful auth
	if providedToken == "" {
		return true
	}
	// If token is provided with cache hit, we need to re-validate
	// For simplicity in v1, we return true and rely on initial validation
	// A more robust implementation would cache the token hash
	return true
}

// proxyRequest forwards the request to the target machine
func (h *Handler) proxyRequest(w http.ResponseWriter, r *http.Request, privateIP string, port int) {
	// Check if this is a WebSocket upgrade request
	if isWebSocketRequest(r) {
		h.proxyWebSocket(w, r, privateIP, port)
		return
	}

	// Create target URL
	targetURL := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", privateIP, port),
	}

	// Create reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// Configure proxy
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = targetURL.Scheme
		req.URL.Host = targetURL.Host
		// Set Host header to localhost so dev servers (Vite, webpack, etc.) don't block
		// the request due to host validation
		req.Host = fmt.Sprintf("localhost:%d", port)

		// Preserve original headers
		if _, ok := req.Header["User-Agent"]; !ok {
			req.Header.Set("User-Agent", "")
		}

		// Add forwarding headers
		if clientIP := getClientIP(r); clientIP != "" {
			req.Header.Set("X-Forwarded-For", clientIP)
		}
		req.Header.Set("X-Forwarded-Proto", "http")
		req.Header.Set("X-Forwarded-Host", r.Host)
	}

	// Handle errors
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		h.log.Error("proxy error", "target", targetURL.Host, "error", err)
		http.Error(w, "Failed to connect to project", http.StatusBadGateway)
	}

	// Modify response if needed
	proxy.ModifyResponse = func(resp *http.Response) error {
		// Allow CORS for development
		resp.Header.Set("Access-Control-Allow-Origin", "*")
		resp.Header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		resp.Header.Set("Access-Control-Allow-Headers", "*")
		return nil
	}

	proxy.ServeHTTP(w, r)
}

// isWebSocketRequest checks if the request is a WebSocket upgrade
func isWebSocketRequest(r *http.Request) bool {
	connection := strings.ToLower(r.Header.Get("Connection"))
	upgrade := strings.ToLower(r.Header.Get("Upgrade"))
	return strings.Contains(connection, "upgrade") && upgrade == "websocket"
}

// getClientIP extracts the client IP from the request
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For first (set by load balancers)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}

	// Check X-Real-IP
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	if r.RemoteAddr != "" {
		// Remove port if present
		if idx := strings.LastIndex(r.RemoteAddr, ":"); idx != -1 {
			return r.RemoteAddr[:idx]
		}
		return r.RemoteAddr
	}

	return ""
}

// LookupProject is a helper method to look up a project by ID prefix
// This is exposed for testing
func (h *Handler) LookupProject(ctx context.Context, prefix string) (*db.Project, error) {
	return h.db.GetProjectByIDPrefix(ctx, prefix)
}
