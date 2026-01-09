package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"aether/db"
	"aether/middleware"
	"aether/validation"
)

// UserSettingsStore interface for database operations
type UserSettingsStore interface {
	GetUserSettings(ctx context.Context, userID string) (*db.UserSettings, error)
	UpdateUserSettings(ctx context.Context, userID string, settings *db.UserSettings) (*db.UserSettings, error)
}

// UserSettingsHandler handles user settings management
type UserSettingsHandler struct {
	db UserSettingsStore
}

// NewUserSettingsHandler creates a new user settings handler
func NewUserSettingsHandler(db UserSettingsStore) *UserSettingsHandler {
	return &UserSettingsHandler{db: db}
}

// HardwareSettingsResponse represents hardware config in response
type HardwareSettingsResponse struct {
	CPUKind      string  `json:"cpu_kind"`
	CPUs         int     `json:"cpus"`
	MemoryMB     int     `json:"memory_mb"`
	VolumeSizeGB int     `json:"volume_size_gb"`
	GPUKind      *string `json:"gpu_kind,omitempty"`
}

// UserSettingsResponse is the response for GET /user/settings
type UserSettingsResponse struct {
	DefaultHardware           HardwareSettingsResponse `json:"default_hardware"`
	DefaultIdleTimeoutMinutes *int                     `json:"default_idle_timeout_minutes,omitempty"`
}

// UpdateUserSettingsRequest is the request body for PUT /user/settings
type UpdateUserSettingsRequest struct {
	DefaultHardware           *HardwareSettingsRequest `json:"default_hardware,omitempty"`
	DefaultIdleTimeoutMinutes *int                     `json:"default_idle_timeout_minutes,omitempty"`
}

// HardwareSettingsRequest represents hardware config in request
type HardwareSettingsRequest struct {
	CPUKind      string  `json:"cpu_kind"`
	CPUs         int     `json:"cpus"`
	MemoryMB     int     `json:"memory_mb"`
	VolumeSizeGB int     `json:"volume_size_gb"`
	GPUKind      *string `json:"gpu_kind,omitempty"`
}

// Get returns the user's settings
func (h *UserSettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		userSettingsWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	settings, err := h.db.GetUserSettings(ctx, userID)
	if err != nil {
		userSettingsWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get user settings"})
		return
	}

	userSettingsWriteJSON(w, http.StatusOK, UserSettingsResponse{
		DefaultHardware: HardwareSettingsResponse{
			CPUKind:      settings.DefaultCPUKind,
			CPUs:         settings.DefaultCPUs,
			MemoryMB:     settings.DefaultMemoryMB,
			VolumeSizeGB: settings.DefaultVolumeSizeGB,
			GPUKind:      settings.DefaultGPUKind,
		},
		DefaultIdleTimeoutMinutes: settings.DefaultIdleTimeoutMinutes,
	})
}

// Update updates the user's settings
func (h *UserSettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		userSettingsWriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req UpdateUserSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		userSettingsWriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	// Get existing settings
	existing, err := h.db.GetUserSettings(ctx, userID)
	if err != nil {
		userSettingsWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get user settings"})
		return
	}

	// Apply updates
	updated := &db.UserSettings{
		UserID:                    userID,
		DefaultCPUKind:            existing.DefaultCPUKind,
		DefaultCPUs:               existing.DefaultCPUs,
		DefaultMemoryMB:           existing.DefaultMemoryMB,
		DefaultVolumeSizeGB:       existing.DefaultVolumeSizeGB,
		DefaultGPUKind:            existing.DefaultGPUKind,
		DefaultIdleTimeoutMinutes: existing.DefaultIdleTimeoutMinutes,
	}

	if req.DefaultHardware != nil {
		updated.DefaultCPUKind = req.DefaultHardware.CPUKind
		updated.DefaultCPUs = req.DefaultHardware.CPUs
		updated.DefaultMemoryMB = req.DefaultHardware.MemoryMB
		updated.DefaultVolumeSizeGB = req.DefaultHardware.VolumeSizeGB
		updated.DefaultGPUKind = req.DefaultHardware.GPUKind

		// Validate hardware config
		_, hwErrors := validation.ValidateHardwareConfig(
			updated.DefaultCPUKind,
			updated.DefaultCPUs,
			updated.DefaultMemoryMB,
			updated.DefaultVolumeSizeGB,
			updated.DefaultGPUKind,
		)
		if hwErrors.HasErrors() {
			userSettingsWriteJSON(w, http.StatusBadRequest, map[string]string{"error": hwErrors.Error()})
			return
		}
	}

	// Handle idle timeout update
	if req.DefaultIdleTimeoutMinutes != nil {
		updated.DefaultIdleTimeoutMinutes = req.DefaultIdleTimeoutMinutes
		if validationErr := validation.ValidateIdleTimeout(updated.DefaultIdleTimeoutMinutes); validationErr != nil {
			userSettingsWriteJSON(w, http.StatusBadRequest, map[string]string{"error": validationErr.Message})
			return
		}
	}

	// Save updates
	result, err := h.db.UpdateUserSettings(ctx, userID, updated)
	if err != nil {
		userSettingsWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update user settings"})
		return
	}

	userSettingsWriteJSON(w, http.StatusOK, UserSettingsResponse{
		DefaultHardware: HardwareSettingsResponse{
			CPUKind:      result.DefaultCPUKind,
			CPUs:         result.DefaultCPUs,
			MemoryMB:     result.DefaultMemoryMB,
			VolumeSizeGB: result.DefaultVolumeSizeGB,
			GPUKind:      result.DefaultGPUKind,
		},
		DefaultIdleTimeoutMinutes: result.DefaultIdleTimeoutMinutes,
	})
}

// userSettingsWriteJSON writes a JSON response
func userSettingsWriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
