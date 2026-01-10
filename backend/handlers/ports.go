package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"aether/db"
	"aether/fly"
	authmw "aether/middleware"
	"aether/ssh"

	"github.com/go-chi/chi/v5"
)

const sshRetryDelay = 2 * time.Second

type PortsHandler struct {
	sshClient *ssh.Client
	flyClient *fly.Client
	db        *db.Client
}

func NewPortsHandler(sshClient *ssh.Client, flyClient *fly.Client, dbClient *db.Client) *PortsHandler {
	return &PortsHandler{
		sshClient: sshClient,
		flyClient: flyClient,
		db:        dbClient,
	}
}

// KillPort kills the process listening on the specified port
func (h *PortsHandler) KillPort(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	portStr := chi.URLParam(r, "port")

	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, "Invalid port number", http.StatusBadRequest)
		return
	}

	userID := authmw.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get project and verify ownership
	project, err := h.db.GetProject(r.Context(), projectID)
	if err != nil {
		if err == db.ErrNotFound {
			http.Error(w, "Project not found", http.StatusNotFound)
			return
		}
		log.Printf("Database error: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if project.UserID != userID {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	if project.Status != "running" {
		http.Error(w, "Project is not running", http.StatusBadRequest)
		return
	}

	if project.FlyMachineID == nil {
		http.Error(w, "Project has no machine", http.StatusBadRequest)
		return
	}

	// Get machine private IP
	machine, err := h.flyClient.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Failed to get machine: %v", err)
		http.Error(w, "Failed to get machine info", http.StatusInternalServerError)
		return
	}

	if machine.PrivateIP == "" {
		http.Error(w, "Machine has no private IP", http.StatusInternalServerError)
		return
	}

	// Use fuser to kill processes listening on the port
	// fuser -k sends SIGKILL to all processes using the port
	cmd := fmt.Sprintf("fuser -k %d/tcp 2>&1 || echo 'no process on port'", port)
	log.Printf("Kill port %d: running command: %s", port, cmd)

	output, err := h.sshClient.ExecWithRetry(machine.PrivateIP, 2222, cmd, 3, sshRetryDelay)
	if err != nil {
		log.Printf("Kill port %d: SSH error: %v", port, err)
		http.Error(w, "Failed to execute kill command", http.StatusInternalServerError)
		return
	}

	log.Printf("Kill port %d: output: %s", port, string(output))
	w.WriteHeader(http.StatusNoContent)
}
