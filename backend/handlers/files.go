package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"aether/db"
	"aether/fly"
	"aether/sftp"
	authmw "aether/middleware"
	"aether/validation"

	"github.com/go-chi/chi/v5"
)

const SSHPort = 2222

type FilesHandler struct {
	sftp    *sftp.Client
	fly     *fly.Client
	db      *db.Client
}

func NewFilesHandler(sftpClient *sftp.Client, flyClient *fly.Client, dbClient *db.Client) *FilesHandler {
	return &FilesHandler{
		sftp: sftpClient,
		fly:  flyClient,
		db:   dbClient,
	}
}

// Request types

type WriteFileRequest struct {
	Content string `json:"content"`
}

type MkdirRequest struct {
	Path string `json:"path"`
}

type RenameRequest struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

// ListTree returns all files and directories in the project
// GET /projects/:id/files/tree
func (h *FilesHandler) ListTree(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	log.Printf("[FILES] ListTree: projectID=%s, userID=%s", projectID, userID)

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	// Get project and verify ownership
	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	// Verify project is running
	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	// Get machine and check actual state
	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	// Get all files
	tree, err := h.sftp.ListAllFiles(machine.PrivateIP, SSHPort)
	if err != nil {
		log.Printf("Error listing all files: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to list files")
		return
	}

	WriteJSON(w, http.StatusOK, tree)
}

// ListOrRead handles both directory listing and file reading based on the path
// GET /projects/:id/files?path=/
func (h *FilesHandler) ListOrRead(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	log.Printf("[FILES] ListOrRead: projectID=%s, userID=%s, path=%s", projectID, userID, r.URL.Query().Get("path"))

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	// Validate file path
	if err := validation.ValidateFilePath(path); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	// Get project and verify ownership
	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	// Verify project is running
	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	// Get machine and check actual state
	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	// Check if machine is actually running (database status might be stale)
	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	// Try to stat the path first to determine if it's a file or directory
	info, err := h.sftp.Stat(machine.PrivateIP, SSHPort, path)
	if err != nil {
		// Check if it's a "not found" error
		if strings.Contains(err.Error(), "not exist") || strings.Contains(err.Error(), "no such file") {
			WriteError(w, http.StatusNotFound, "Path not found")
			return
		}
		log.Printf("Error stating path: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to access path")
		return
	}

	// If it's a file (has content), read it
	// We detect this by checking if the path ends with a file extension or stat size > 0
	// Better approach: try to list as directory first
	listing, err := h.sftp.List(machine.PrivateIP, SSHPort, path)
	if err == nil {
		// It's a directory, return listing
		WriteJSON(w, http.StatusOK, listing)
		return
	}

	// Not a directory, must be a file - read it
	fileInfo, err := h.sftp.Read(machine.PrivateIP, SSHPort, path)
	if err != nil {
		if strings.Contains(err.Error(), "too large") {
			WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error":    "File too large",
				"size":     info.Size,
				"max_size": sftp.MaxFileSize,
			})
			return
		}
		if strings.Contains(err.Error(), "binary") {
			WriteError(w, http.StatusBadRequest, "Binary files cannot be edited")
			return
		}
		log.Printf("Error reading file: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to read file")
		return
	}

	WriteJSON(w, http.StatusOK, fileInfo)
}

// Write handles file creation and updates
// PUT /projects/:id/files?path=/foo.js
func (h *FilesHandler) Write(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "Path is required")
		return
	}

	if err := validation.ValidateFilePath(path); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	var req WriteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Get project and verify ownership
	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	fileInfo, err := h.sftp.Write(machine.PrivateIP, SSHPort, path, []byte(req.Content))
	if err != nil {
		if strings.Contains(err.Error(), "too large") {
			WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error":    "Content too large",
				"max_size": sftp.MaxFileSize,
			})
			return
		}
		log.Printf("Error writing file: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to write file")
		return
	}

	WriteJSON(w, http.StatusOK, fileInfo)
}

// Mkdir creates a directory
// POST /projects/:id/files/mkdir
func (h *FilesHandler) Mkdir(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	var req MkdirRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Path == "" {
		WriteError(w, http.StatusBadRequest, "Path is required")
		return
	}

	if err := validation.ValidateFilePath(req.Path); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	if err := h.sftp.Mkdir(machine.PrivateIP, SSHPort, req.Path); err != nil {
		log.Printf("Error creating directory: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to create directory")
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]string{
		"path": filepath.Join(sftp.WorkingDir, strings.TrimPrefix(req.Path, "/")),
	})
}

// Delete removes a file or directory
// DELETE /projects/:id/files?path=/foo.js
func (h *FilesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "Path is required")
		return
	}

	if err := validation.ValidateFilePath(path); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	if err := h.sftp.Delete(machine.PrivateIP, SSHPort, path); err != nil {
		if strings.Contains(err.Error(), "not exist") || strings.Contains(err.Error(), "no such file") {
			WriteError(w, http.StatusNotFound, "Path not found")
			return
		}
		log.Printf("Error deleting: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to delete")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Rename moves or renames a file or directory
// POST /projects/:id/files/rename
func (h *FilesHandler) Rename(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	var req RenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		WriteError(w, http.StatusBadRequest, "Both old_path and new_path are required")
		return
	}

	if err := validation.ValidateFilePath(req.OldPath); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	if err := validation.ValidateFilePath(req.NewPath); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	if project.Status != "running" {
		WriteError(w, http.StatusBadRequest, "Project is not running")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM")
		return
	}

	machine, err := h.fly.GetMachine(*project.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get VM")
		return
	}

	if machine.State != "started" {
		WriteError(w, http.StatusServiceUnavailable, "VM is not running")
		return
	}

	if err := h.sftp.Rename(machine.PrivateIP, SSHPort, req.OldPath, req.NewPath); err != nil {
		if strings.Contains(err.Error(), "not exist") || strings.Contains(err.Error(), "no such file") {
			WriteError(w, http.StatusNotFound, "Source path not found")
			return
		}
		log.Printf("Error renaming: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to rename")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{
		"path": filepath.Join(sftp.WorkingDir, strings.TrimPrefix(req.NewPath, "/")),
	})
}
