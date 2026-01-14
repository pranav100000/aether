package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"aether/db"
	"aether/handlers/proxy"
	authmw "aether/middleware"

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
func (h *WorkspaceHandler) updateLastAccessedDebounced(projectID string) {
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
		log.Printf("Error updating last accessed for project %s: %v", projectID, err)
	}
}

// HandleWorkspace handles unified WebSocket connections for all channels
func (h *WorkspaceHandler) HandleWorkspace(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	// Get user ID from context or WebSocket subprotocol
	userID := authmw.GetUserID(r.Context())
	if userID == "" {
		token := ExtractTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var err error
		userID, err = h.authMiddleware.ValidateToken(token)
		if err != nil {
			log.Printf("Token validation error: %v", err)
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}
	}

	// Get project (verifies ownership)
	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			http.Error(w, "Project not found", http.StatusNotFound)
			return
		}
		log.Printf("Error getting project: %v", err)
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
		log.Printf("Error getting connection info: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Upgrade to WebSocket
	responseHeader := http.Header{}
	if websocket.Subprotocols(r) != nil {
		responseHeader.Set("Sec-WebSocket-Protocol", "bearer")
	}

	wsConn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer wsConn.Close()

	log.Printf("Workspace WebSocket connected for project: %s", projectID)

	// Build environment variables for the agent (includes API keys)
	agentEnv := NewEnvBuilder(h.apiKeys).BuildAgentEnv(r.Context(), projectID, userID)

	// Create connector to VM's unified workspace endpoint
	connector := proxy.NewWebSocketConnector()
	config := proxy.ConnectorConfig{
		Host:           connInfo.Host,
		Port:           connInfo.WebSocketPort,
		Endpoint:       "/workspace", // Unified endpoint
		Environment:    agentEnv,
		ConnectTimeout: 10 * time.Second,
	}

	ctx := r.Context()
	if err := connector.Connect(ctx, config); err != nil {
		log.Printf("Workspace connector error: %v", err)
		sendWorkspaceError(wsConn, "Failed to connect to workspace: "+err.Error())
		return
	}
	defer connector.Close()

	log.Printf("Workspace connector established for project %s", projectID)

	// Bridge the frontend WebSocket with the VM connector
	h.bridgeConnection(ctx, wsConn, connector, projectID)

	log.Printf("Workspace session ended for project: %s", projectID)
}

// bridgeConnection bridges the frontend WebSocket with the VM ProxyConnector
func (h *WorkspaceHandler) bridgeConnection(ctx context.Context, wsConn *websocket.Conn, connector proxy.ProxyConnector, projectID string) {
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
				wsConn.SetWriteDeadline(time.Now().Add(writeWait))
				err := wsConn.WriteMessage(websocket.TextMessage, data)
				wsMu.Unlock()
				if err != nil {
					log.Printf("Workspace WebSocket write error: %v", err)
					return
				}
				// Update last accessed on activity
				go h.updateLastAccessedDebounced(projectID)
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
		wsConn.SetReadDeadline(time.Now().Add(pongWait))
		wsConn.SetPongHandler(func(string) error {
			wsConn.SetReadDeadline(time.Now().Add(pongWait))
			return nil
		})

		for {
			select {
			case <-connector.Done():
				return
			default:
			}

			_, data, err := wsConn.ReadMessage()
			if err != nil {
				log.Printf("Workspace WebSocket read error: %v", err)
				connector.Close()
				return
			}

			// Update last accessed on activity
			go h.updateLastAccessedDebounced(projectID)

			if err := connector.Send(ctx, data); err != nil {
				log.Printf("Workspace connector send error: %v", err)
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

	// Wait for connector to close
	<-connector.Done()
	wg.Wait()
}

func (h *WorkspaceHandler) pingLoop(conn *websocket.Conn, done <-chan struct{}, wsMu *sync.Mutex) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			wsMu.Lock()
			conn.SetWriteDeadline(time.Now().Add(writeWait))
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
	conn.WriteJSON(msg)
}
