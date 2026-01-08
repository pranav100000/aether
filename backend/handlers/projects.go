package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"aether/db"
	"aether/fly"
	authmw "aether/middleware"

	"github.com/go-chi/chi/v5"
)

type ProjectHandler struct {
	db          *db.Client
	fly         *fly.Client
	baseImage   string
	idleTimeout time.Duration
}

func NewProjectHandler(db *db.Client, fly *fly.Client, baseImage string, idleTimeout time.Duration) *ProjectHandler {
	return &ProjectHandler{
		db:          db,
		fly:         fly,
		baseImage:   baseImage,
		idleTimeout: idleTimeout,
	}
}

// Request/Response types

type CreateProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type UpdateProjectRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type ProjectResponse struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Description    *string    `json:"description,omitempty"`
	Status         string     `json:"status"`
	FlyMachineID   *string    `json:"fly_machine_id,omitempty"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type ProjectListResponse struct {
	Projects []ProjectResponse `json:"projects"`
}

type StartResponse struct {
	Status      string `json:"status"`
	TerminalURL string `json:"terminal_url"`
}

type StopResponse struct {
	Status string `json:"status"`
}

// Helpers

func projectToResponse(p *db.Project) ProjectResponse {
	return ProjectResponse{
		ID:             p.ID,
		Name:           p.Name,
		Description:    p.Description,
		Status:         p.Status,
		FlyMachineID:   p.FlyMachineID,
		LastAccessedAt: p.LastAccessedAt,
		CreatedAt:      p.CreatedAt,
		UpdatedAt:      p.UpdatedAt,
	}
}

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

// Handlers

func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())

	projects, err := h.db.ListProjects(r.Context(), userID)
	if err != nil {
		log.Printf("Error listing projects: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to list projects")
		return
	}

	response := ProjectListResponse{Projects: make([]ProjectResponse, len(projects))}
	for i, p := range projects {
		response.Projects[i] = projectToResponse(&p)
	}

	respondJSON(w, http.StatusOK, response)
}

func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())

	var req CreateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "Name is required")
		return
	}

	if len(req.Name) > 100 {
		respondError(w, http.StatusBadRequest, "Name must be 100 characters or less")
		return
	}

	var description *string
	if req.Description != "" {
		description = &req.Description
	}

	project, err := h.db.CreateProject(r.Context(), userID, req.Name, description, h.baseImage)
	if err != nil {
		log.Printf("Error creating project: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to create project")
		return
	}

	respondJSON(w, http.StatusCreated, projectToResponse(project))
}

func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	respondJSON(w, http.StatusOK, projectToResponse(project))
}

func (h *ProjectHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	var req UpdateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name != nil && len(*req.Name) > 100 {
		respondError(w, http.StatusBadRequest, "Name must be 100 characters or less")
		return
	}

	project, err := h.db.UpdateProject(r.Context(), projectID, userID, req.Name, req.Description)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error updating project: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to update project")
		return
	}

	respondJSON(w, http.StatusOK, projectToResponse(project))
}

func (h *ProjectHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	// Get project first to check for machine
	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for delete: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to delete project")
		return
	}

	// Destroy Fly machine if exists
	if project.FlyMachineID != nil && *project.FlyMachineID != "" {
		if err := h.fly.DeleteMachine(*project.FlyMachineID); err != nil {
			log.Printf("Warning: failed to delete Fly machine %s: %v", *project.FlyMachineID, err)
			// Continue with deletion anyway
		}
	}

	// Delete from database
	if err := h.db.DeleteProject(r.Context(), projectID, userID); err != nil {
		log.Printf("Error deleting project: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to delete project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ProjectHandler) Start(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for start: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to start project")
		return
	}

	// Update status to starting
	if err := h.db.UpdateProjectStatus(r.Context(), projectID, "starting", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// If no machine exists, create one
	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		machine, err := h.createMachine(r.Context(), project)
		if err != nil {
			log.Printf("Error creating machine: %v", err)
			errMsg := err.Error()
			h.db.UpdateProjectStatus(r.Context(), projectID, "error", &errMsg)
			respondError(w, http.StatusInternalServerError, "Failed to create VM")
			return
		}

		if err := h.db.UpdateProjectMachine(r.Context(), projectID, machine.ID); err != nil {
			log.Printf("Error updating project machine ID: %v", err)
		}

		project.FlyMachineID = &machine.ID
	} else {
		// Machine exists, start it
		if err := h.fly.StartMachine(*project.FlyMachineID); err != nil {
			log.Printf("Error starting machine: %v", err)
			errMsg := err.Error()
			h.db.UpdateProjectStatus(r.Context(), projectID, "error", &errMsg)
			respondError(w, http.StatusInternalServerError, "Failed to start VM")
			return
		}
	}

	// Wait for machine to be running
	if err := h.fly.WaitForState(*project.FlyMachineID, "started", 60*time.Second); err != nil {
		log.Printf("Error waiting for machine to start: %v", err)
		errMsg := err.Error()
		h.db.UpdateProjectStatus(r.Context(), projectID, "error", &errMsg)
		respondError(w, http.StatusInternalServerError, "VM failed to start")
		return
	}

	// Update status to running
	if err := h.db.UpdateProjectStatus(r.Context(), projectID, "running", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// Update last accessed
	if err := h.db.UpdateProjectLastAccessed(r.Context(), projectID); err != nil {
		log.Printf("Error updating last accessed: %v", err)
	}

	respondJSON(w, http.StatusOK, StartResponse{
		Status:      "running",
		TerminalURL: "/projects/" + projectID + "/terminal",
	})
}

func (h *ProjectHandler) Stop(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			respondError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for stop: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to stop project")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		respondError(w, http.StatusBadRequest, "Project has no VM to stop")
		return
	}

	// Update status to stopping
	if err := h.db.UpdateProjectStatus(r.Context(), projectID, "stopping", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// Stop the machine
	if err := h.fly.StopMachine(*project.FlyMachineID); err != nil {
		log.Printf("Error stopping machine: %v", err)
		errMsg := err.Error()
		h.db.UpdateProjectStatus(r.Context(), projectID, "error", &errMsg)
		respondError(w, http.StatusInternalServerError, "Failed to stop VM")
		return
	}

	// Update status to stopped
	if err := h.db.UpdateProjectStatus(r.Context(), projectID, "stopped", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	respondJSON(w, http.StatusOK, StopResponse{Status: "stopped"})
}

func (h *ProjectHandler) createMachine(ctx context.Context, project *db.Project) (*fly.Machine, error) {
	config := fly.MachineConfig{
		Image: h.baseImage,
		Guest: fly.GuestConfig{
			CPUKind:  "shared",
			CPUs:     1,
			MemoryMB: 256,
		},
		Env: map[string]string{
			"PROJECT_ID": project.ID,
		},
	}

	machineName := "aether-" + project.ID[:8]
	return h.fly.CreateMachine(machineName, config)
}

// StartIdleChecker starts background goroutine to stop idle projects
func (h *ProjectHandler) StartIdleChecker(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			h.checkIdleProjects()
		}
	}()
}

func (h *ProjectHandler) checkIdleProjects() {
	ctx := context.Background()

	projects, err := h.db.GetIdleRunningProjects(ctx, h.idleTimeout)
	if err != nil {
		log.Printf("Error checking idle projects: %v", err)
		return
	}

	for _, p := range projects {
		log.Printf("Stopping idle project: %s", p.ID)
		if p.FlyMachineID != nil && *p.FlyMachineID != "" {
			if err := h.fly.StopMachine(*p.FlyMachineID); err != nil {
				log.Printf("Error stopping idle machine: %v", err)
				continue
			}
		}
		if err := h.db.UpdateProjectStatus(ctx, p.ID, "stopped", nil); err != nil {
			log.Printf("Error updating idle project status: %v", err)
		}
	}
}
