package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type mockPinger struct {
	err error
}

func (m *mockPinger) Ping(ctx context.Context) error {
	return m.err
}

func TestHealthHandler_Health_Healthy(t *testing.T) {
	handler := NewHealthHandler(&mockPinger{}, "v1.0.0")

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	handler.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Status != "ok" {
		t.Errorf("expected status 'ok', got %s", response.Status)
	}

	if response.Version != "v1.0.0" {
		t.Errorf("expected version 'v1.0.0', got %s", response.Version)
	}

	if response.Checks["database"] != "ok" {
		t.Errorf("expected database check 'ok', got %v", response.Checks["database"])
	}
}

func TestHealthHandler_Health_DatabaseError(t *testing.T) {
	handler := NewHealthHandler(&mockPinger{err: errors.New("connection refused")}, "v1.0.0")

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	handler.Health(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status %d, got %d", http.StatusServiceUnavailable, rr.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Status != "degraded" {
		t.Errorf("expected status 'degraded', got %s", response.Status)
	}

	if response.Checks["database"] != "error" {
		t.Errorf("expected database check 'error', got %v", response.Checks["database"])
	}
}

func TestHealthHandler_Liveness(t *testing.T) {
	handler := NewHealthHandler(&mockPinger{}, "v1.0.0")

	req := httptest.NewRequest("GET", "/healthz", nil)
	rr := httptest.NewRecorder()

	handler.Liveness(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	expected := `{"status":"ok"}`
	if rr.Body.String() != expected {
		t.Errorf("expected body %q, got %q", expected, rr.Body.String())
	}
}

func TestHealthHandler_Readiness_Ready(t *testing.T) {
	handler := NewHealthHandler(&mockPinger{}, "v1.0.0")

	req := httptest.NewRequest("GET", "/ready", nil)
	rr := httptest.NewRecorder()

	handler.Readiness(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
	}
}

func TestHealthHandler_Readiness_NotReady(t *testing.T) {
	handler := NewHealthHandler(&mockPinger{err: errors.New("db down")}, "v1.0.0")

	req := httptest.NewRequest("GET", "/ready", nil)
	rr := httptest.NewRecorder()

	handler.Readiness(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status %d, got %d", http.StatusServiceUnavailable, rr.Code)
	}
}

func TestHealthHandler_NilDatabase(t *testing.T) {
	handler := NewHealthHandler(nil, "v1.0.0")

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	handler.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var response HealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Status != "ok" {
		t.Errorf("expected status 'ok', got %s", response.Status)
	}
}
