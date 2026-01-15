package handlers

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"aether/apps/api/db"
	"aether/apps/api/handlers/proxy"
	authmw "aether/apps/api/middleware"
	"aether/libs/go/logging"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// WorkspaceHandler handles unified WebSocket connections for terminal, agent, files, and ports
type WorkspaceHandler struct {
	resolver         ConnectionResolver
	db               *db.Client
	authMiddleware   *authmw.AuthMiddleware
	apiKeys          APIKeysGetter
	lastAccessedMu   sync.Mutex
	lastAccessedTime map[string]time.Time
}

func NewWorkspaceHandler(resolver ConnectionResolver, db *db.Client, authMiddleware *authmw.AuthMiddleware, apiKeys APIKeysGetter) *WorkspaceHandler {
	return &WorkspaceHandler{
		resolver:         resolver,
		db:               db,
		authMiddleware:   authMiddleware,
		apiKeys:          apiKeys,
		lastAccessedTime: make(map[string]time.Time),
	}
}

// updateLastAccessedDebounced updates last_accessed_at at most once per 30 seconds per project
func (h *WorkspaceHandler) updateLastAccessedDebounced(ctx context.Context, projectID string) {
	h.lastAccessedMu.Lock()
	lastUpdate, exists := h.lastAccessedTime[projectID]
	now := time.Now()
	if exists && now.Sub(lastUpdate) < 30*time.Second {
		h.lastAccessedMu.Unlock()
		return
	}
	h.lastAccessedTime[projectID] = now
	h.lastAccessedMu.Unlock()

	if err := h.db.UpdateProjectLastAccessed(context.Background(), projectID); err != nil {
		log := logging.FromContext(ctx)
		log.Error("failed to update last accessed", "project_id", projectID, "error", err)
	}
}

// clearLastAccessed removes the project from the debounce map when connection closes
func (h *WorkspaceHandler) clearLastAccessed(projectID string) {
	h.lastAccessedMu.Lock()
	delete(h.lastAccessedTime, projectID)
	h.lastAccessedMu.Unlock()
}

// HandleWorkspace handles unified WebSocket connections for all channels
func (h *WorkspaceHandler) HandleWorkspace(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	// Enrich context with project ID for logging
	ctx := r.Context()
	ctx = logging.WithProjectID(ctx, projectID)

	// Get user ID from context or WebSocket subprotocol
	userID := authmw.GetUserID(ctx)
	if userID == "" {
		token := ExtractTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var err error
		userID, err = h.authMiddleware.ValidateToken(token)
		if err != nil {
			log := logging.FromContext(ctx)
			log.Warn("token validation failed", "error", err)
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}
	}

	// Enrich context with user ID
	ctx = logging.WithUserID(ctx, userID)
	log := logging.FromContext(ctx)

	// Get project (verifies ownership)
	project, err := h.db.GetProjectByUser(ctx, projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			http.Error(w, "Project not found", http.StatusNotFound)
			return
		}
		log.Error("failed to get project", "error", err)
		http.Error(w, "Failed to get project", http.StatusInternalServerError)
		return
	}

	if project.Status != "running" {
		http.Error(w, "Project is not running", http.StatusBadRequest)
		return
	}

	// Get connection info
	connInfo, err := h.resolver.GetConnectionInfo(project)
	if err != nil {
		log.Error("failed to get connection info", "error", err)
		http.Error(w, "Failed to connect to workspace", http.StatusInternalServerError)
		return
	}

	// Upgrade to WebSocket
	responseHeader := http.Header{}
	if websocket.Subprotocols(r) != nil {
		responseHeader.Set("Sec-WebSocket-Protocol", "bearer")
	}

	wsConn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Error("websocket upgrade failed", "error", err)
		return
	}
	defer func() {
		if err := wsConn.Close(); err != nil {
			log.Error("failed to close websocket", "error", err)
		}
	}()

	log.Info("workspace websocket connected")

	// Build environment variables for the agent (includes API keys)
	agentEnv := NewEnvBuilder(h.apiKeys).BuildAgentEnv(ctx, projectID, userID)

	// Add correlation IDs for workspace-service logging
	if requestID := logging.GetRequestID(ctx); requestID != "" {
		agentEnv["CORRELATION_REQUEST_ID"] = requestID
	}
	agentEnv["CORRELATION_USER_ID"] = userID
	agentEnv["CORRELATION_PROJECT_ID"] = projectID

	// Create connector to VM's unified workspace endpoint
	connector := proxy.NewWebSocketConnector()
	config := proxy.ConnectorConfig{
		Host:           connInfo.Host,
		Port:           connInfo.WebSocketPort,
		Endpoint:       "/workspace", // Unified endpoint
		Environment:    agentEnv,
		ConnectTimeout: 10 * time.Second,
	}

	if err := connector.Connect(ctx, config); err != nil {
		log.Error("workspace connector failed", "host", connInfo.Host, "port", connInfo.WebSocketPort, "error", err)
		sendWorkspaceError(wsConn, "Failed to connect to workspace: "+err.Error())
		return
	}
	defer func() {
		if err := connector.Close(); err != nil {
			log.Error("failed to close connector", "error", err)
		}
	}()

	log.Info("workspace connector established")

	// Bridge the frontend WebSocket with the VM connector
	h.bridgeConnection(ctx, wsConn, connector, projectID)

	log.Info("workspace session ended")
}

// bridgeConnection bridges the frontend WebSocket with the VM ProxyConnector
func (h *WorkspaceHandler) bridgeConnection(ctx context.Context, wsConn *websocket.Conn, connector proxy.ProxyConnector, projectID string) {
	defer h.clearLastAccessed(projectID)
	log := logging.FromContext(ctx)

	var wg sync.WaitGroup
	var wsMu sync.Mutex

	// Connector -> WebSocket (forward raw messages from VM to frontend)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case data, ok := <-connector.Receive():
				if !ok {
					return
				}
				wsMu.Lock()
				if err := wsConn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
					wsMu.Unlock()
					log.Debug("failed to set write deadline", "error", err)
					return
				}
				err := wsConn.WriteMessage(websocket.TextMessage, data)
				wsMu.Unlock()
				if err != nil {
					log.Debug("websocket write error", "error", err)
					return
				}
				// Update last accessed on activity
				go h.updateLastAccessedDebounced(ctx, projectID)
			case <-connector.Done():
				return
			}
		}
	}()

	// WebSocket -> Connector (forward raw messages from frontend to VM)
	wg.Add(1)
	go func() {
		defer wg.Done()
		wsConn.SetReadLimit(maxMessageSize)
		if err := wsConn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
			log.Debug("failed to set read deadline", "error", err)
			return
		}
		wsConn.SetPongHandler(func(string) error {
			return wsConn.SetReadDeadline(time.Now().Add(pongWait))
		})

		for {
			select {
			case <-connector.Done():
				return
			default:
			}

			_, data, err := wsConn.ReadMessage()
			if err != nil {
				log.Debug("websocket read error", "error", err)
				if err := connector.Close(); err != nil {
					log.Debug("failed to close connector", "error", err)
				}
				return
			}

			// Update last accessed on activity
			go h.updateLastAccessedDebounced(ctx, projectID)

			if err := connector.Send(ctx, data); err != nil {
				log.Debug("connector send error", "error", err)
				return
			}
		}
	}()

	// Ping loop for WebSocket keepalive
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.pingLoop(wsConn, connector.Done(), &wsMu)
	}()

	// Wait for connector to close, then close websocket to unblock ReadMessage
	<-connector.Done()
	if err := wsConn.Close(); err != nil {
		log.Debug("failed to close websocket", "error", err)
	}
	wg.Wait()
}

func (h *WorkspaceHandler) pingLoop(conn *websocket.Conn, done <-chan struct{}, wsMu *sync.Mutex) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			wsMu.Lock()
			if err := conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				wsMu.Unlock()
				return
			}
			err := conn.WriteMessage(websocket.PingMessage, nil)
			wsMu.Unlock()

			if err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func sendWorkspaceError(conn *websocket.Conn, message string) {
	msg := map[string]string{
		"channel": "error",
		"type":    "error",
		"error":   message,
	}
	if err := conn.WriteJSON(msg); err != nil {
		return
	}
}
