package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"aether/db"
	"aether/fly"
	authmw "aether/middleware"
	"aether/ssh"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

type AgentHandler struct {
	sshClient      *ssh.Client
	fly            *fly.Client
	db             *db.Client
	authMiddleware *authmw.AuthMiddleware
	apiKeys        APIKeysGetter
}

func NewAgentHandler(sshClient *ssh.Client, fly *fly.Client, db *db.Client, authMiddleware *authmw.AuthMiddleware, apiKeys APIKeysGetter) *AgentHandler {
	return &AgentHandler{
		sshClient:      sshClient,
		fly:            fly,
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
	Extra     map[string]interface{} `json:"-"` // For any additional fields
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

	// Validate agent type
	if agentType != "claude" && agentType != "codex" && agentType != "codebuff" && agentType != "opencode" {
		http.Error(w, "Invalid agent type", http.StatusBadRequest)
		return
	}

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

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		http.Error(w, "Project has no VM", http.StatusBadRequest)
		return
	}

	// Get machine details from Fly
	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		http.Error(w, "Failed to get machine info", http.StatusInternalServerError)
		return
	}

	if machine.PrivateIP == "" {
		http.Error(w, "Machine has no IP address", http.StatusInternalServerError)
		return
	}

	// Upgrade to WebSocket
	responseHeader := http.Header{}
	if websocket.Subprotocols(r) != nil {
		responseHeader.Set("Sec-WebSocket-Protocol", "bearer")
	}

	conn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("Agent WebSocket connected for project: %s, agent: %s", projectID, agentType)

	// Build fresh env vars for the agent (includes user's latest API keys)
	agentEnv := NewEnvBuilder(h.apiKeys).BuildAgentEnv(r.Context(), projectID, userID)
	envContent := ToEnvFileContent(agentEnv)
	encodedEnv := base64.StdEncoding.EncodeToString([]byte(envContent))

	// Connect to SSH
	sshSession, err := h.sshClient.ConnectWithRetry(machine.PrivateIP, 2222, 5, 2*time.Second)
	if err != nil {
		log.Printf("SSH connection error: %v", err)
		sendAgentError(conn, "Failed to connect to machine: "+err.Error())
		return
	}
	defer sshSession.Close()

	// Start the agent CLI
	// Write env vars via base64 (avoids shell escaping issues), then source and run
	// Use "." instead of "source" for POSIX shell compatibility
	// cd to project directory so agent runs in correct context
	cmd := fmt.Sprintf("echo %s | base64 -d > ~/.aether_env && . ~/.aether_env && cd /home/coder/project && exec /usr/local/bin/bun /opt/agent-service/src/cli.ts %s", encodedEnv, agentType)
	log.Printf("Starting agent for project %s", projectID)
	if err := sshSession.Start(cmd); err != nil {
		log.Printf("Agent start error: %v", err)
		sendAgentError(conn, "Failed to start agent: "+err.Error())
		return
	}
	log.Printf("Agent command started successfully")

	done := make(chan struct{})
	var wg sync.WaitGroup
	var closeOnce sync.Once
	var wsMu sync.Mutex

	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	go sshSession.KeepAlive(30*time.Second, done)

	// Read from agent stdout -> WebSocket
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromAgent(conn, sshSession, done, closeDone, projectID, &wsMu)
	}()

	// Read from agent stderr -> WebSocket (as errors)
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readAgentStderr(conn, sshSession, done, &wsMu)
	}()

	// Read from WebSocket -> agent stdin
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromWebSocket(conn, sshSession, done, closeDone)
	}()

	// Ping loop
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.pingLoop(conn, done, &wsMu)
	}()

	<-done
	wg.Wait()

	log.Printf("Agent session ended for project: %s", projectID)
}

func (h *AgentHandler) readFromAgent(conn *websocket.Conn, session *ssh.Session, done chan struct{}, closeDone func(), projectID string, wsMu *sync.Mutex) {
	buf := make([]byte, 4096)
	var buffer strings.Builder

	log.Printf("Starting to read from agent stdout...")

	for {
		select {
		case <-done:
			log.Printf("readFromAgent: done channel closed")
			return
		default:
		}

		n, err := session.Read(buf)
		log.Printf("Agent stdout read: n=%d, err=%v", n, err)
		if err != nil {
			if err != io.EOF {
				log.Printf("Agent read error: %v", err)
			}
			closeDone()
			return
		}

		if n > 0 {
			buffer.Write(buf[:n])

			// Process complete JSON lines
			content := buffer.String()
			lines := strings.Split(content, "\n")

			// Keep the last incomplete line in the buffer
			buffer.Reset()
			if len(lines) > 0 && !strings.HasSuffix(content, "\n") {
				buffer.WriteString(lines[len(lines)-1])
				lines = lines[:len(lines)-1]
			}

			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}

				// Parse and forward the JSON message
				var msg AgentMessage
				if err := json.Unmarshal([]byte(line), &msg); err != nil {
					// If not valid JSON, send as text
					msg = AgentMessage{Type: "text", Content: line}
				}

				wsMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				err := conn.WriteJSON(msg)
				wsMu.Unlock()

				if err != nil {
					log.Printf("WebSocket write error: %v", err)
					closeDone()
					return
				}
			}
		}
	}
}

func (h *AgentHandler) readAgentStderr(conn *websocket.Conn, session *ssh.Session, done chan struct{}, wsMu *sync.Mutex) {
	buf := make([]byte, 4096)
	stderr := session.Stderr()

	for {
		select {
		case <-done:
			return
		default:
		}

		n, err := stderr.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("Agent stderr read error: %v", err)
			}
			return
		}

		if n > 0 {
			content := strings.TrimSpace(string(buf[:n]))
			if content != "" {
				log.Printf("Agent stderr: %s", content)
				// Send stderr to frontend as error message
				wsMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				conn.WriteJSON(AgentMessage{
					Type:  "error",
					Error: content,
				})
				wsMu.Unlock()
			}
		}
	}
}

func (h *AgentHandler) readFromWebSocket(conn *websocket.Conn, session *ssh.Session, done chan struct{}, closeDone func()) {
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		select {
		case <-done:
			return
		default:
		}

		var msg AgentMessage
		log.Printf("Waiting for WebSocket message...")
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("WebSocket ReadJSON error: %v", err)
			closeDone()
			return
		}
		log.Printf("Received WebSocket message: type=%s", msg.Type)

		// Forward message to agent stdin as JSON
		jsonData, err := json.Marshal(msg)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			continue
		}

		// Add newline for JSON lines protocol
		jsonData = append(jsonData, '\n')

		log.Printf("Forwarding to agent stdin: %s", string(jsonData))

		n, err := session.Write(jsonData)
		if err != nil {
			log.Printf("Agent write error: %v", err)
			closeDone()
			return
		}
		log.Printf("Wrote %d bytes to agent stdin", n)
	}
}

func (h *AgentHandler) pingLoop(conn *websocket.Conn, done chan struct{}, wsMu *sync.Mutex) {
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
