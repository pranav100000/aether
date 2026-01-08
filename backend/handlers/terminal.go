package handlers

import (
	"context"
	"encoding/json"
	"errors"
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
	sshClient      *ssh.Client
	fly            *fly.Client
	db             *db.Client
	authMiddleware *authmw.AuthMiddleware
}

func NewTerminalHandler(sshClient *ssh.Client, fly *fly.Client, db *db.Client, authMiddleware *authmw.AuthMiddleware) *TerminalHandler {
	return &TerminalHandler{
		sshClient:      sshClient,
		fly:            fly,
		db:             db,
		authMiddleware: authMiddleware,
	}
}

type WSMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func (h *TerminalHandler) HandleTerminal(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	// Get user ID from context (set by auth middleware for regular HTTP)
	// or from WebSocket subprotocol for WebSocket connections
	userID := authmw.GetUserID(r.Context())

	// If no user ID in context, try to extract from WebSocket subprotocol
	if userID == "" {
		token := extractTokenFromRequest(r)
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

	log.Printf("WebSocket connected for project: %s", projectID)

	// Connect to SSH
	sshSession, err := h.sshClient.ConnectWithRetry(machine.PrivateIP, 2222, 5, 2*time.Second)
	if err != nil {
		log.Printf("SSH connection error: %v", err)
		sendError(conn, "Failed to connect to machine: "+err.Error())
		return
	}
	defer sshSession.Close()

	if err := sshSession.RequestPTY("xterm-256color", 80, 24); err != nil {
		log.Printf("PTY request error: %v", err)
		sendError(conn, "Failed to allocate terminal")
		return
	}

	if err := sshSession.StartShell(); err != nil {
		log.Printf("Shell start error: %v", err)
		sendError(conn, "Failed to start shell")
		return
	}

	done := make(chan struct{})
	var wg sync.WaitGroup
	var closeOnce sync.Once

	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	go sshSession.KeepAlive(30*time.Second, done)

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSSH(conn, sshSession, done, closeDone, projectID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSSHStderr(conn, sshSession, done)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromWebSocket(conn, sshSession, done, closeDone, projectID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.pingLoop(conn, done)
	}()

	<-done
	wg.Wait()

	log.Printf("Terminal session ended for project: %s", projectID)
}

func extractTokenFromRequest(r *http.Request) string {
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

func (h *TerminalHandler) readFromSSH(conn *websocket.Conn, session *ssh.Session, done chan struct{}, closeDone func(), projectID string) {
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
				log.Printf("SSH read error: %v", err)
			}
			closeDone()
			return
		}

		if n > 0 {
			// Update last accessed (fire and forget)
			go h.db.UpdateProjectLastAccessed(context.Background(), projectID)

			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
			}

			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("WebSocket write error: %v", err)
				closeDone()
				return
			}
		}
	}
}

func (h *TerminalHandler) readFromSSHStderr(conn *websocket.Conn, session *ssh.Session, done chan struct{}) {
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
				log.Printf("SSH stderr read error: %v", err)
			}
			return
		}

		if n > 0 {
			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
			}

			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (h *TerminalHandler) readFromWebSocket(conn *websocket.Conn, session *ssh.Session, done chan struct{}, closeDone func(), projectID string) {
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
		go h.db.UpdateProjectLastAccessed(context.Background(), projectID)

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

func (h *TerminalHandler) pingLoop(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
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

// Legacy handler for backward compatibility with /machines endpoint
type LegacyTerminalHandler struct {
	sshClient      *ssh.Client
	machineHandler *MachineHandler
}

func NewLegacyTerminalHandler(sshClient *ssh.Client, machineHandler *MachineHandler) *LegacyTerminalHandler {
	return &LegacyTerminalHandler{
		sshClient:      sshClient,
		machineHandler: machineHandler,
	}
}

func (h *LegacyTerminalHandler) HandleTerminal(w http.ResponseWriter, r *http.Request) {
	machineID := chi.URLParam(r, "id")

	state := h.machineHandler.GetMachineState(machineID)
	if state == nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Refresh status from Fly API
	h.machineHandler.RefreshMachineStatus(machineID)
	state = h.machineHandler.GetMachineState(machineID)

	if state.Status != "started" && state.Status != "running" {
		log.Printf("Machine %s is not running, status: %s", machineID, state.Status)
		http.Error(w, "Machine is not running", http.StatusBadRequest)
		return
	}

	if state.PrivateIP == "" {
		http.Error(w, "Machine has no IP address", http.StatusInternalServerError)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("WebSocket connected for machine: %s", machineID)

	sshSession, err := h.sshClient.ConnectWithRetry(state.PrivateIP, 2222, 5, 2*time.Second)
	if err != nil {
		log.Printf("SSH connection error: %v", err)
		sendError(conn, "Failed to connect to machine: "+err.Error())
		return
	}
	defer sshSession.Close()

	if err := sshSession.RequestPTY("xterm-256color", 80, 24); err != nil {
		log.Printf("PTY request error: %v", err)
		sendError(conn, "Failed to allocate terminal")
		return
	}

	if err := sshSession.StartShell(); err != nil {
		log.Printf("Shell start error: %v", err)
		sendError(conn, "Failed to start shell")
		return
	}

	done := make(chan struct{})
	var wg sync.WaitGroup

	go sshSession.KeepAlive(30*time.Second, done)

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSSH(conn, sshSession, done, machineID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromSSHStderr(conn, sshSession, done)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.readFromWebSocket(conn, sshSession, done, machineID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		h.pingLoop(conn, done)
	}()

	<-done
	wg.Wait()

	log.Printf("Terminal session ended for machine: %s", machineID)
}

func (h *LegacyTerminalHandler) readFromSSH(conn *websocket.Conn, session *ssh.Session, done chan struct{}, machineID string) {
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
				log.Printf("SSH read error: %v", err)
			}
			close(done)
			return
		}

		if n > 0 {
			h.machineHandler.UpdateActivity(machineID)

			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
			}

			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("WebSocket write error: %v", err)
				close(done)
				return
			}
		}
	}
}

func (h *LegacyTerminalHandler) readFromSSHStderr(conn *websocket.Conn, session *ssh.Session, done chan struct{}) {
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
				log.Printf("SSH stderr read error: %v", err)
			}
			return
		}

		if n > 0 {
			msg := WSMessage{
				Type: "output",
				Data: string(buf[:n]),
			}

			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (h *LegacyTerminalHandler) readFromWebSocket(conn *websocket.Conn, session *ssh.Session, done chan struct{}, machineID string) {
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
			return
		}

		h.machineHandler.UpdateActivity(machineID)

		switch msg.Type {
		case "input":
			if _, err := session.Write([]byte(msg.Data)); err != nil {
				log.Printf("SSH write error: %v", err)
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

func (h *LegacyTerminalHandler) pingLoop(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}
