package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// DatabasePinger interface for health checks
type DatabasePinger interface {
	Ping(ctx context.Context) error
}

type HealthHandler struct {
	db        DatabasePinger
	startTime time.Time
	version   string
}

func NewHealthHandler(db DatabasePinger, version string) *HealthHandler {
	return &HealthHandler{
		db:        db,
		startTime: time.Now(),
		version:   version,
	}
}

type HealthResponse struct {
	Status    string         `json:"status"`
	Version   string         `json:"version,omitempty"`
	Uptime    string         `json:"uptime"`
	Timestamp string         `json:"timestamp"`
	Checks    map[string]any `json:"checks"`
}

func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	checks := make(map[string]any)
	overallStatus := "ok"

	// Database check
	dbStatus := "ok"
	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			dbStatus = "error"
			overallStatus = "degraded"
			checks["database_error"] = err.Error()
		}
	}
	checks["database"] = dbStatus

	response := HealthResponse{
		Status:    overallStatus,
		Version:   h.version,
		Uptime:    time.Since(h.startTime).Round(time.Second).String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Checks:    checks,
	}

	w.Header().Set("Content-Type", "application/json")
	if overallStatus != "ok" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(response)
}

// Liveness is a simple check for Kubernetes-style liveness probes
func (h *HealthHandler) Liveness(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

// Readiness checks if the service is ready to accept traffic
func (h *HealthHandler) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "not ready",
				"error":  "database unavailable",
			})
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ready"}`))
}
