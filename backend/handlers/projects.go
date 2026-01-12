package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"aether/db"
	authmw "aether/middleware"
	"aether/validation"

	"github.com/go-chi/chi/v5"
)

// APIKeysGetter interface for fetching decrypted API keys
type APIKeysGetter interface {
	GetDecryptedKeys(ctx context.Context, userID string) (map[string]string, error)
}

type ProjectHandler struct {
	store         ProjectStore
	machines      MachineManager
	volumes       VolumeManager
	apiKeys       APIKeysGetter
	baseImage     string
	defaultRegion string
	idleTimeout   time.Duration
}

func NewProjectHandler(store ProjectStore, machines MachineManager, volumes VolumeManager, apiKeys APIKeysGetter, baseImage string, defaultRegion string, idleTimeout time.Duration) *ProjectHandler {
	return &ProjectHandler{
		store:         store,
		machines:      machines,
		volumes:       volumes,
		apiKeys:       apiKeys,
		baseImage:     baseImage,
		defaultRegion: defaultRegion,
		idleTimeout:   idleTimeout,
	}
}

// Request/Response types

type HardwareConfigRequest struct {
	Preset       string  `json:"preset,omitempty"`
	CPUKind      string  `json:"cpu_kind,omitempty"`
	CPUs         int     `json:"cpus,omitempty"`
	MemoryMB     int     `json:"memory_mb,omitempty"`
	VolumeSizeGB int     `json:"volume_size_gb,omitempty"`
	GPUKind      *string `json:"gpu_kind,omitempty"`
}

// HardwareConfigResponse is an alias for the shared HardwareConfig type
type HardwareConfigResponse = HardwareConfig

type CreateProjectRequest struct {
	Name               string                 `json:"name"`
	Description        string                 `json:"description,omitempty"`
	Hardware           *HardwareConfigRequest `json:"hardware,omitempty"`
	IdleTimeoutMinutes *int                   `json:"idle_timeout_minutes,omitempty"`
}

type UpdateProjectRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type ProjectResponse struct {
	ID                 string                 `json:"id"`
	Name               string                 `json:"name"`
	Description        *string                `json:"description,omitempty"`
	Status             string                 `json:"status"`
	Hardware           HardwareConfigResponse `json:"hardware"`
	IdleTimeoutMinutes *int                   `json:"idle_timeout_minutes,omitempty"`
	FlyMachineID       *string                `json:"fly_machine_id,omitempty"`
	PrivateIP          *string                `json:"private_ip,omitempty"`
	LastAccessedAt     *time.Time             `json:"last_accessed_at,omitempty"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
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
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Status:      p.Status,
		Hardware: HardwareConfigResponse{
			CPUKind:      p.CPUKind,
			CPUs:         p.CPUs,
			MemoryMB:     p.MemoryMB,
			VolumeSizeGB: p.VolumeSizeGB,
			GPUKind:      p.GPUKind,
		},
		IdleTimeoutMinutes: p.IdleTimeoutMinutes,
		FlyMachineID:       p.FlyMachineID,
		LastAccessedAt:     p.LastAccessedAt,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
	}
}

// Handlers

func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())

	projects, err := h.store.ListProjects(r.Context(), userID)
	if err != nil {
		log.Printf("Error listing projects: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to list projects")
		return
	}

	response := ProjectListResponse{Projects: make([]ProjectResponse, len(projects))}
	for i, p := range projects {
		response.Projects[i] = projectToResponse(&p)
	}

	WriteJSON(w, http.StatusOK, response)
}

func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())

	var req CreateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error decoding create project request: %v", err)
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var idleTimeoutLog string
	if req.IdleTimeoutMinutes != nil {
		idleTimeoutLog = fmt.Sprintf("%d", *req.IdleTimeoutMinutes)
	} else {
		idleTimeoutLog = "nil"
	}
	log.Printf("Create project request: user=%s name=%q hardware=%+v idleTimeout=%s", userID, req.Name, req.Hardware, idleTimeoutLog)

	// Handle hardware config - frontend always sends the actual values
	var hwConfig *validation.HardwareConfig
	if req.Hardware != nil {
		if req.Hardware.Preset != "" {
			hwConfig = validation.GetPresetConfig(req.Hardware.Preset)
		} else {
			hwConfig = &validation.HardwareConfig{
				CPUKind:      req.Hardware.CPUKind,
				CPUs:         req.Hardware.CPUs,
				MemoryMB:     req.Hardware.MemoryMB,
				VolumeSizeGB: req.Hardware.VolumeSizeGB,
				GPUKind:      req.Hardware.GPUKind,
			}
		}
	}

	// Idle timeout - frontend always sends the actual value
	idleTimeoutMinutes := req.IdleTimeoutMinutes

	// Validate idle timeout
	if err := validation.ValidateIdleTimeout(idleTimeoutMinutes); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	input, errs := validation.ValidateCreateProject(req.Name, req.Description, hwConfig)
	if errs.HasErrors() {
		log.Printf("Validation failed for create project: %v", errs)
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": errs,
		})
		return
	}

	// Convert validation.HardwareConfig to db.HardwareConfig
	dbHwConfig := &db.HardwareConfig{
		CPUKind:      input.Hardware.CPUKind,
		CPUs:         input.Hardware.CPUs,
		MemoryMB:     input.Hardware.MemoryMB,
		VolumeSizeGB: input.Hardware.VolumeSizeGB,
		GPUKind:      input.Hardware.GPUKind,
	}

	project, err := h.store.CreateProject(r.Context(), userID, input.Name, input.Description, h.baseImage, dbHwConfig, idleTimeoutMinutes)
	if err != nil {
		log.Printf("Error creating project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to create project")
		return
	}

	WriteJSON(w, http.StatusCreated, projectToResponse(project))
}

func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.store.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	response := projectToResponse(project)

	// Fetch private IP from Fly if machine exists
	if project.FlyMachineID != nil && *project.FlyMachineID != "" {
		machine, err := h.machines.GetMachine(*project.FlyMachineID)
		if err == nil && machine.PrivateIP != "" {
			response.PrivateIP = &machine.PrivateIP
		}
	}

	WriteJSON(w, http.StatusOK, response)
}

func (h *ProjectHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	var req UpdateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	input, errs := validation.ValidateUpdateProject(req.Name, req.Description)
	if errs.HasErrors() {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": errs,
		})
		return
	}

	project, err := h.store.UpdateProject(r.Context(), projectID, userID, input.Name, input.Description)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error updating project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to update project")
		return
	}

	WriteJSON(w, http.StatusOK, projectToResponse(project))
}

func (h *ProjectHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	// Get project first to check for machine
	project, err := h.store.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for delete: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to delete project")
		return
	}

	// Destroy Fly machine if exists
	if project.FlyMachineID != nil && *project.FlyMachineID != "" {
		if err := h.machines.DeleteMachine(*project.FlyMachineID); err != nil {
			log.Printf("Error: failed to delete Fly machine %s: %v", *project.FlyMachineID, err)
			WriteError(w, http.StatusInternalServerError, "Failed to delete VM from Fly.io")
			return
		}
	}

	// Destroy Fly volume if exists
	if project.FlyVolumeID != nil && *project.FlyVolumeID != "" {
		if err := h.volumes.DeleteVolume(*project.FlyVolumeID); err != nil {
			log.Printf("Error: failed to delete Fly volume %s: %v", *project.FlyVolumeID, err)
			WriteError(w, http.StatusInternalServerError, "Failed to delete volume from Fly.io")
			return
		}
	}

	// Delete from database
	if err := h.store.DeleteProject(r.Context(), projectID, userID); err != nil {
		log.Printf("Error deleting project: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to delete project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ProjectHandler) Start(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.store.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for start: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to start project")
		return
	}

	// Update status to starting
	if err := h.store.UpdateProjectStatus(r.Context(), projectID, "starting", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// Start machine in background goroutine
	go h.startMachineAsync(projectID, project, userID)

	// Return immediately
	WriteJSON(w, http.StatusAccepted, StartResponse{
		Status:      "starting",
		TerminalURL: "/projects/" + projectID + "/terminal",
	})
}

// startMachineAsync handles machine creation/startup in the background
func (h *ProjectHandler) startMachineAsync(projectID string, project *db.Project, userID string) {
	ctx := context.Background()

	// Create volume if it doesn't exist
	if project.FlyVolumeID == nil || *project.FlyVolumeID == "" {
		volumeName := "vol_" + projectID[:8]
		// GPU machines must be in ord region, so volumes must match
		region := h.defaultRegion
		if project.GPUKind != nil && *project.GPUKind != "" {
			region = "ord"
		}
		volume, err := h.volumes.CreateVolume(volumeName, project.VolumeSizeGB, region)
		if err != nil {
			log.Printf("Error creating volume: %v", err)
			errMsg := "Failed to create storage volume: " + err.Error()
			h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
			return
		}

		if err := h.store.UpdateProjectVolume(ctx, projectID, volume.ID); err != nil {
			log.Printf("Error updating project volume ID: %v", err)
		}

		project.FlyVolumeID = &volume.ID
		log.Printf("Created volume %s for project %s", volume.ID, projectID)
	}

	// If no machine exists, create one
	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		machine, err := h.createMachine(ctx, project, userID)
		if err != nil {
			log.Printf("Error creating machine: %v", err)
			errMsg := err.Error()
			h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
			return
		}

		if err := h.store.UpdateProjectMachine(ctx, projectID, machine.ID); err != nil {
			log.Printf("Error updating project machine ID: %v", err)
		}

		project.FlyMachineID = &machine.ID
	} else {
		// Machine exists, start it
		if err := h.machines.StartMachine(*project.FlyMachineID); err != nil {
			log.Printf("Error starting machine: %v", err)
			errMsg := err.Error()
			h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
			return
		}
	}

	// Wait for machine to be running
	if err := h.machines.WaitForState(*project.FlyMachineID, "started", 60*time.Second); err != nil {
		log.Printf("Error waiting for machine to start: %v", err)
		errMsg := err.Error()
		h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
		return
	}

	// Update status to running
	if err := h.store.UpdateProjectStatus(ctx, projectID, "running", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// Update last accessed
	if err := h.store.UpdateProjectLastAccessed(ctx, projectID); err != nil {
		log.Printf("Error updating last accessed: %v", err)
	}

	log.Printf("Project %s started successfully", projectID)
}

func (h *ProjectHandler) Stop(w http.ResponseWriter, r *http.Request) {
	userID := authmw.GetUserID(r.Context())
	projectID := chi.URLParam(r, "id")

	if err := validation.ValidateUUID(projectID, "id"); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "Validation failed",
			"errors": []validation.ValidationError{*err},
		})
		return
	}

	project, err := h.store.GetProjectByUser(r.Context(), projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Printf("Error getting project for stop: %v", err)
		WriteError(w, http.StatusInternalServerError, "Failed to stop project")
		return
	}

	if project.FlyMachineID == nil || *project.FlyMachineID == "" {
		WriteError(w, http.StatusBadRequest, "Project has no VM to stop")
		return
	}

	// Update status to stopping
	if err := h.store.UpdateProjectStatus(r.Context(), projectID, "stopping", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	// Stop machine in background goroutine
	go h.stopMachineAsync(projectID, *project.FlyMachineID)

	// Return immediately
	WriteJSON(w, http.StatusAccepted, StopResponse{Status: "stopping"})
}

// stopMachineAsync handles machine shutdown in the background
func (h *ProjectHandler) stopMachineAsync(projectID string, machineID string) {
	ctx := context.Background()

	// Stop the machine
	if err := h.machines.StopMachine(machineID); err != nil {
		log.Printf("Error stopping machine: %v", err)
		errMsg := err.Error()
		h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
		return
	}

	// Wait for machine to be stopped
	if err := h.machines.WaitForState(machineID, "stopped", 30*time.Second); err != nil {
		log.Printf("Error waiting for machine to stop: %v", err)
		errMsg := err.Error()
		h.store.UpdateProjectStatus(ctx, projectID, "error", &errMsg)
		return
	}

	// Update status to stopped
	if err := h.store.UpdateProjectStatus(ctx, projectID, "stopped", nil); err != nil {
		log.Printf("Error updating project status: %v", err)
	}

	log.Printf("Project %s stopped successfully", projectID)
}

func (h *ProjectHandler) createMachine(ctx context.Context, project *db.Project, userID string) (*Machine, error) {
	var guestConfig GuestConfig

	// GPU machines require cpu_kind and cpus, but Fly.io determines actual compute from gpu_kind
	if project.GPUKind != nil && *project.GPUKind != "" {
		guestConfig = GuestConfig{
			CPUKind:  "performance",
			CPUs:     8,
			MemoryMB: 16384,
			GPUKind:  *project.GPUKind,
		}
		log.Printf("Creating GPU machine with gpu_kind=%s", *project.GPUKind)
	} else {
		guestConfig = GuestConfig{
			CPUKind:  project.CPUKind,
			CPUs:     project.CPUs,
			MemoryMB: project.MemoryMB,
		}
		log.Printf("Creating CPU machine with cpu_kind=%s, cpus=%d, memory_mb=%d", project.CPUKind, project.CPUs, project.MemoryMB)
	}

	// Build environment variables
	machineEnv := NewEnvBuilder(h.apiKeys).BuildEnv(ctx, project.ID, userID, nil)
	log.Printf("Creating machine with %d env vars", len(machineEnv))
	config := MachineConfig{
		Image: h.baseImage,
		Guest: guestConfig,
		Env:   machineEnv,
	}

	// Attach volume if exists
	if project.FlyVolumeID != nil && *project.FlyVolumeID != "" {
		config.Mounts = []Mount{{
			Volume: *project.FlyVolumeID,
			Path:   "/home/coder/project",
		}}
	}

	machineName := "aether-" + project.ID[:8]
	return h.machines.CreateMachine(machineName, config)
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

	projects, err := h.store.GetRunningProjects(ctx)
	if err != nil {
		log.Printf("Error checking idle projects: %v", err)
		return
	}

	for _, p := range projects {
		// Only check projects that have an explicit idle timeout set
		if p.IdleTimeoutMinutes == nil {
			// No idle timeout set - never auto-stop
			continue
		}

		if *p.IdleTimeoutMinutes == 0 {
			// 0 means never auto-stop
			continue
		}

		timeout := time.Duration(*p.IdleTimeoutMinutes) * time.Minute

		if p.LastAccessedAt == nil {
			continue
		}

		idleFor := time.Since(*p.LastAccessedAt)
		log.Printf("Idle check: project %s idle for %v, timeout %v", p.ID, idleFor.Round(time.Second), timeout)

		if idleFor <= timeout {
			continue
		}

		log.Printf("Stopping idle project: %s (idle for %v, timeout: %v)", p.ID, idleFor, timeout)
		if p.FlyMachineID != nil && *p.FlyMachineID != "" {
			if err := h.machines.StopMachine(*p.FlyMachineID); err != nil {
				log.Printf("Error stopping idle machine: %v", err)
				continue
			}
		}
		if err := h.store.UpdateProjectStatus(ctx, p.ID, "stopped", nil); err != nil {
			log.Printf("Error updating idle project status: %v", err)
		}
	}
}
