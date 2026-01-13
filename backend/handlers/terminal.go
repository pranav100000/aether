package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"aether/db"
	authmw "aether/middleware"
	"aether/ssh"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 8192
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	Subprotocols: []string{"bearer"},
}

type TerminalHandler struct {
	terminalProvider TerminalProvider
	resolver         ConnectionResolver
	db               *db.Client
	authMiddleware   *authmw.AuthMiddleware
	sshClient        *ssh.Client // For file/port watchers
	lastAccessedMu   sync.Mutex
	lastAccessedTime map[string]time.Time
}

func NewTerminalHandler(terminalProvider TerminalProvider, resolver ConnectionResolver, db *db.Client, authMiddleware *authmw.AuthMiddleware, sshClient *ssh.Client) *TerminalHandler {
	return &TerminalHandler{
		terminalProvider: terminalProvider,
		resolver:         resolver,
		db:               db,
		authMiddleware:   authMiddleware,
		sshClient:        sshClient,
		lastAccessedTime: make(map[string]time.Time),
	}
}

// updateLastAccessedDebounced updates last_accessed_at at most once per 30 seconds per project
func (h *TerminalHandler) updateLastAccessedDebounced(projectID string) {
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

type WSMessage struct {
	Type        string `json:"type"`
	Data        string `json:"data,omitempty"`
	Cols        int    `json:"cols,omitempty"`
	Rows        int    `json:"rows,omitempty"`
	Action      string `json:"action,omitempty"`       // For file_change: create, modify, delete; For port_change: open, close
	Path        string `json:"path,omitempty"`         // For file_change: the file path
	IsDirectory bool   `json:"is_directory,omitempty"` // For file_change: true if path is a directory
	Port        int    `json:"port,omitempty"`         // For port_change: the port number
}

func (h *TerminalHandler) HandleTerminal(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	// Get user ID from context (set by auth middleware for regular HTTP)
	// or from WebSocket subprotocol for WebSocket connections
	userID := authmw.GetUserID(r.Context())

	// If no user ID in context, try to extract from WebSocket subprotocol
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

	conn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("WebSocket connected for project: %s", projectID)

	// Create terminal session
	session, err := h.terminalProvider.CreateSessionWithRetry(connInfo.Host, connInfo.Port, 5, 2*time.Second)
	if err != nil {
		log.Printf("Terminal connection error: %v", err)
		sendError(conn, "Failed to connect to machine: "+err.Error())
		return
	}
	defer session.Close()

	if err := session.RequestPTY("xterm-256color", 80, 24); err != nil {
		log.Printf("PTY request error: %v", err)
		sendError(conn, "Failed to allocate terminal")
		return
	}

	if err := session.StartShell(); err != nil {
		log.Printf("Shell start error: %v", err)
		sendError(conn, "Failed to start shell")
		return
	}

	done := make(chan struct{})
	var wg sync.WaitGroup
	var closeOnce sync.Once
	var wsMu sync.Mutex // Mutex for websocket writes

	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	go session.KeepAlive(30*time.Second, done)

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSession(conn, session, done, closeDone, projectID, &wsMu)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSessionStderr(conn, session, done, &wsMu)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromWebSocketToSession(conn, session, done, closeDone, projectID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.pingLoop(conn, done, &wsMu)
	}()

	// Start file watcher and port watcher
	if h.sshClient != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.startFileWatcher(conn, connInfo, done, &wsMu)
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			h.startPortWatcher(conn, connInfo, done, &wsMu)
		}()
	}

	<-done
	wg.Wait()

	log.Printf("Terminal session ended for project: %s", projectID)
}

func (h *TerminalHandler) readFromSession(conn *websocket.Conn, session TerminalSession, done chan struct{}, closeDone func(), projectID string, wsMu *sync.Mutex) {
	buf := make([]byte, 4096)

	for {
		select {
		case <-done:
			return
		default:
		}

		n, err := session.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("Session read error: %v", err)
			}
			closeDone()
			return
		}

		if n > 0 {
			// Update last accessed (fire and forget)
			go h.updateLastAccessedDebounced(projectID)

			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
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

func (h *TerminalHandler) readFromSessionStderr(conn *websocket.Conn, session TerminalSession, done chan struct{}, wsMu *sync.Mutex) {
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
				log.Printf("Session stderr read error: %v", err)
			}
			return
		}

		if n > 0 {
			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
			}

			wsMu.Lock()
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			err := conn.WriteJSON(msg)
			wsMu.Unlock()

			if err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (h *TerminalHandler) readFromWebSocketToSession(conn *websocket.Conn, session TerminalSession, done chan struct{}, closeDone func(), projectID string) {
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

		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			closeDone()
			return
		}

		// Update last accessed (fire and forget)
		go h.updateLastAccessedDebounced(projectID)

		switch msg.Type {
		case "input":
			if _, err := session.Write([]byte(msg.Data)); err != nil {
				log.Printf("SSH write error: %v", err)
				closeDone()
				return
			}

		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				if err := session.Resize(msg.Cols, msg.Rows); err != nil {
					log.Printf("Terminal resize error: %v", err)
				}
			}
		}
	}
}

func (h *TerminalHandler) pingLoop(conn *websocket.Conn, done chan struct{}, wsMu *sync.Mutex) {
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

func sendError(conn *websocket.Conn, message string) {
	msg := WSMessage{
		Type: "error",
		Data: message,
	}
	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (h *TerminalHandler) startFileWatcher(conn *websocket.Conn, connInfo *ConnectionInfo, done chan struct{}, wsMu *sync.Mutex) {
	// Connect to SSH for file watching
	watchSession, err := h.sshClient.ConnectWithRetry(connInfo.Host, connInfo.Port, 3, 2*time.Second)
	if err != nil {
		log.Printf("File watcher SSH connection error: %v", err)
		return
	}
	defer watchSession.Close()

	// Run inotifywait to watch for file changes in /home/coder/project
	// -m: monitor mode (keep running)
	// -r: recursive
	// -e: events to watch
	// --format: output format (event type and file path)
	cmd := `inotifywait -m -r -e create,modify,delete,moved_to,moved_from --format '%e %w%f' /home/coder/project 2>/dev/null`
	if err := watchSession.Start(cmd); err != nil {
		log.Printf("File watcher start error: %v", err)
		return
	}

	go watchSession.KeepAlive(30*time.Second, done)

	buf := make([]byte, 4096)
	for {
		select {
		case <-done:
			return
		default:
		}

		n, err := watchSession.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("File watcher read error: %v", err)
			}
			return
		}

		if n > 0 {
			// Parse inotifywait output: "EVENT /path/to/file"
			lines := strings.Split(string(buf[:n]), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}

				parts := strings.SplitN(line, " ", 2)
				if len(parts) != 2 {
					continue
				}

				event := parts[0]
				fullPath := parts[1]

				// Get path relative to project directory
				relPath, err := filepath.Rel("/home/coder/project", fullPath)
				if err != nil {
					continue
				}
				path := "/" + relPath

				// Check if this is a directory event (inotify includes ISDIR in event string)
				isDirectory := strings.Contains(event, "ISDIR")

				// Map inotify events to our action types
				var action string
				switch {
				case strings.Contains(event, "CREATE") || strings.Contains(event, "MOVED_TO"):
					action = "create"
				case strings.Contains(event, "MODIFY"):
					action = "modify"
				case strings.Contains(event, "DELETE") || strings.Contains(event, "MOVED_FROM"):
					action = "delete"
				default:
					continue
				}

				// Send file change message
				msg := WSMessage{
					Type:        "file_change",
					Action:      action,
					Path:        path,
					IsDirectory: isDirectory,
				}

				wsMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				writeErr := conn.WriteJSON(msg)
				wsMu.Unlock()

				if writeErr != nil {
					log.Printf("File watcher WebSocket write error: %v", writeErr)
					return
				}
			}
		}
	}
}

func (h *TerminalHandler) startPortWatcher(conn *websocket.Conn, connInfo *ConnectionInfo, done chan struct{}, wsMu *sync.Mutex) {
	log.Printf("Port watcher: starting for %s:%d", connInfo.Host, connInfo.Port)

	// Connect to SSH for port watching
	watchSession, err := h.sshClient.ConnectWithRetry(connInfo.Host, connInfo.Port, 3, 2*time.Second)
	if err != nil {
		log.Printf("Port watcher SSH connection error: %v", err)
		return
	}
	defer watchSession.Close()

	log.Printf("Port watcher: SSH connected, starting binary")

	// Run port-watcher binary (uses netlink to detect listening ports)
	// Outputs: "LISTEN 5173" or "CLOSE 5173"
	cmd := `/usr/local/bin/port-watcher`
	if err := watchSession.Start(cmd); err != nil {
		log.Printf("Port watcher start error: %v", err)
		return
	}

	log.Printf("Port watcher: binary started, reading output")

	go watchSession.KeepAlive(30*time.Second, done)

	// Log stderr from port-watcher for debugging
	go func() {
		stderrBuf := make([]byte, 4096)
		for {
			n, err := watchSession.Stderr().Read(stderrBuf)
			if err != nil {
				return
			}
			if n > 0 {
				log.Printf("Port watcher stderr: %s", string(stderrBuf[:n]))
			}
		}
	}()

	buf := make([]byte, 4096)
	for {
		select {
		case <-done:
			return
		default:
		}

		n, err := watchSession.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("Port watcher read error: %v", err)
			}
			return
		}

		if n > 0 {
			log.Printf("Port watcher: received data: %q", string(buf[:n]))
			// Parse port-watcher output: "LISTEN 5173" or "CLOSE 5173"
			lines := strings.Split(string(buf[:n]), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}

				parts := strings.SplitN(line, " ", 2)
				if len(parts) != 2 {
					continue
				}

				event := parts[0]
				portStr := parts[1]

				var port int
				if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
					continue
				}

				var action string
				switch event {
				case "LISTEN":
					action = "open"
				case "CLOSE":
					action = "close"
				default:
					continue
				}

				// Send port change message
				msg := WSMessage{
					Type:   "port_change",
					Action: action,
					Port:   port,
				}

				wsMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				err := conn.WriteJSON(msg)
				wsMu.Unlock()

				if err != nil {
					log.Printf("Port watcher WebSocket write error: %v", err)
					return
				}
			}
		}
	}
}
