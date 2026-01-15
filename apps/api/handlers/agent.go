package handlers

import (
	"context"
	"encoding/json"
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

type AgentHandler struct {
	resolver       ConnectionResolver
	db             *db.Client
	authMiddleware *authmw.AuthMiddleware
	apiKeys        APIKeysGetter
}

func NewAgentHandler(resolver ConnectionResolver, db *db.Client, authMiddleware *authmw.AuthMiddleware, apiKeys APIKeysGetter) *AgentHandler {
	return &AgentHandler{
		resolver:       resolver,
		db:             db,
		authMiddleware: authMiddleware,
		apiKeys:        apiKeys,
	}
}

// AgentMessage represents messages to/from the agent CLI
type AgentMessage struct {
	Type      string                 `json:"type"`
	Agent     string                 `json:"agent,omitempty"`
	SessionID string                 `json:"sessionId,omitempty"`
	Content   string                 `json:"content,omitempty"`
	Streaming bool                   `json:"streaming,omitempty"`
	Tool      *ToolInfo              `json:"tool,omitempty"`
	ToolID    string                 `json:"toolId,omitempty"`
	Result    string                 `json:"result,omitempty"`
	Usage     *UsageInfo             `json:"usage,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Prompt    string                 `json:"prompt,omitempty"`
	Settings  map[string]interface{} `json:"settings,omitempty"`
	Context   *PromptContext         `json:"context,omitempty"`
	History   []StoredMessage        `json:"history,omitempty"`
	Extra     map[string]interface{} `json:"-"` // For any additional fields
}

// StoredMessage represents a message from chat history
type StoredMessage struct {
	ID        string       `json:"id"`
	Timestamp int64        `json:"timestamp"`
	Role      string       `json:"role"`
	Content   string       `json:"content"`
	Tool      *ToolMessage `json:"tool,omitempty"`
}

// ToolMessage represents tool use in a stored message
type ToolMessage struct {
	ID     string                 `json:"id"`
	Name   string                 `json:"name"`
	Input  map[string]interface{} `json:"input"`
	Status string                 `json:"status"`
	Result string                 `json:"result,omitempty"`
	Error  string                 `json:"error,omitempty"`
}

// PromptContext contains file references and attachments sent with prompts
type PromptContext struct {
	Files       []FileReference `json:"files,omitempty"`
	Attachments []Attachment    `json:"attachments,omitempty"`
}

// FileReference is a file attached via @mentions
type FileReference struct {
	Path      string          `json:"path"`
	Include   bool            `json:"include"`
	Selection *SelectionRange `json:"selection,omitempty"`
}

// SelectionRange specifies a range of lines in a file
type SelectionRange struct {
	StartLine int `json:"startLine"`
	EndLine   int `json:"endLine"`
}

// Attachment is a binary file attachment (images, documents)
type Attachment struct {
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

type ToolInfo struct {
	ID     string                 `json:"id"`
	Name   string                 `json:"name"`
	Input  map[string]interface{} `json:"input"`
	Status string                 `json:"status"`
}

type UsageInfo struct {
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	Cost         float64 `json:"cost"`
}

// HandleAgent handles WebSocket connections for the agent
func (h *AgentHandler) HandleAgent(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	agentType := chi.URLParam(r, "agent")

	// Enrich context for logging
	ctx := r.Context()
	ctx = logging.WithProjectID(ctx, projectID)

	// Validate agent type
	if agentType != "claude" && agentType != "codex" && agentType != "codebuff" && agentType != "opencode" {
		http.Error(w, "Invalid agent type", http.StatusBadRequest)
		return
	}

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
		log.Error("websocket upgrade failed", "error", err)
		return
	}
	defer wsConn.Close()

	log.Info("agent websocket connected", "agent", agentType)

	// Build fresh env vars for the agent (includes user's latest API keys)
	agentEnv := NewEnvBuilder(h.apiKeys).BuildAgentEnv(ctx, projectID, userID)

	// Add correlation IDs for workspace-service logging
	if requestID := logging.GetRequestID(ctx); requestID != "" {
		agentEnv["CORRELATION_REQUEST_ID"] = requestID
	}
	agentEnv["CORRELATION_USER_ID"] = userID
	agentEnv["CORRELATION_PROJECT_ID"] = projectID

	// Create connector and connect to VM via WebSocket
	connector := proxy.NewWebSocketConnector()
	config := proxy.ConnectorConfig{
		Host:           connInfo.Host,
		Port:           connInfo.WebSocketPort,
		AgentType:      agentType,
		Environment:    agentEnv,
		ConnectTimeout: 10 * time.Second,
	}

	if err := connector.Connect(ctx, config); err != nil {
		log.Error("agent connector failed", "error", err)
		sendAgentError(wsConn, "Failed to connect to agent: "+err.Error())
		return
	}
	defer connector.Close()

	log.Info("agent connector established")

	// Bridge the frontend WebSocket with the VM connector
	h.bridgeConnection(ctx, wsConn, connector)

	log.Info("agent session ended")
}

// bridgeConnection bridges the frontend WebSocket with the VM ProxyConnector
func (h *AgentHandler) bridgeConnection(ctx context.Context, wsConn *websocket.Conn, connector proxy.ProxyConnector) {
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
				wsConn.SetWriteDeadline(time.Now().Add(writeWait))
				err := wsConn.WriteMessage(websocket.TextMessage, data)
				wsMu.Unlock()
				if err != nil {
					log.Debug("websocket write error", "error", err)
					return
				}
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
				log.Debug("websocket read error", "error", err)
				connector.Close()
				return
			}

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

	// Wait for connector to close
	<-connector.Done()
	wg.Wait()
}

func (h *AgentHandler) pingLoop(conn *websocket.Conn, done <-chan struct{}, wsMu *sync.Mutex) {
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

func sendAgentError(conn *websocket.Conn, message string) {
	msg := AgentMessage{
		Type:  "error",
		Error: message,
	}
	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)
}
