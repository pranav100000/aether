package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aether/db"
	"aether/fly"
	authmw "aether/middleware"

	"github.com/go-chi/chi/v5"
)

// Mock implementations

type mockProjectStore struct {
	projects       map[string]*db.Project
	listProjectsFn func(ctx context.Context, userID string) ([]db.Project, error)
	createFn       func(ctx context.Context, userID, name string, description *string, baseImage string) (*db.Project, error)
	getFn          func(ctx context.Context, projectID, userID string) (*db.Project, error)
	updateFn       func(ctx context.Context, projectID, userID string, name, description *string) (*db.Project, error)
	deleteFn       func(ctx context.Context, projectID, userID string) error
}

func newMockStore() *mockProjectStore {
	return &mockProjectStore{
		projects: make(map[string]*db.Project),
	}
}

func (m *mockProjectStore) ListProjects(ctx context.Context, userID string) ([]db.Project, error) {
	if m.listProjectsFn != nil {
		return m.listProjectsFn(ctx, userID)
	}
	var result []db.Project
	for _, p := range m.projects {
		if p.UserID == userID {
			result = append(result, *p)
		}
	}
	return result, nil
}

func (m *mockProjectStore) GetProject(ctx context.Context, projectID string) (*db.Project, error) {
	if p, ok := m.projects[projectID]; ok {
		return p, nil
	}
	return nil, db.ErrNotFound
}

func (m *mockProjectStore) GetProjectByUser(ctx context.Context, projectID, userID string) (*db.Project, error) {
	if m.getFn != nil {
		return m.getFn(ctx, projectID, userID)
	}
	if p, ok := m.projects[projectID]; ok && p.UserID == userID {
		return p, nil
	}
	return nil, db.ErrNotFound
}

func (m *mockProjectStore) CreateProject(ctx context.Context, userID, name string, description *string, baseImage string) (*db.Project, error) {
	if m.createFn != nil {
		return m.createFn(ctx, userID, name, description, baseImage)
	}
	p := &db.Project{
		ID:          "test-project-id",
		UserID:      userID,
		Name:        name,
		Description: description,
		Status:      "stopped",
		BaseImage:   baseImage,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	m.projects[p.ID] = p
	return p, nil
}

func (m *mockProjectStore) UpdateProject(ctx context.Context, projectID, userID string, name, description *string) (*db.Project, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, projectID, userID, name, description)
	}
	p, ok := m.projects[projectID]
	if !ok || p.UserID != userID {
		return nil, db.ErrNotFound
	}
	if name != nil {
		p.Name = *name
	}
	if description != nil {
		p.Description = description
	}
	p.UpdatedAt = time.Now()
	return p, nil
}

func (m *mockProjectStore) DeleteProject(ctx context.Context, projectID, userID string) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, projectID, userID)
	}
	if p, ok := m.projects[projectID]; ok && p.UserID == userID {
		delete(m.projects, projectID)
		return nil
	}
	return db.ErrNotFound
}

func (m *mockProjectStore) UpdateProjectStatus(ctx context.Context, projectID, status string, errorMsg *string) error {
	if p, ok := m.projects[projectID]; ok {
		p.Status = status
		p.ErrorMessage = errorMsg
		return nil
	}
	return nil
}

func (m *mockProjectStore) UpdateProjectMachine(ctx context.Context, projectID, machineID string) error {
	if p, ok := m.projects[projectID]; ok {
		p.FlyMachineID = &machineID
		return nil
	}
	return nil
}

func (m *mockProjectStore) UpdateProjectLastAccessed(ctx context.Context, projectID string) error {
	if p, ok := m.projects[projectID]; ok {
		now := time.Now()
		p.LastAccessedAt = &now
		return nil
	}
	return nil
}

func (m *mockProjectStore) GetIdleRunningProjects(ctx context.Context, timeout time.Duration) ([]db.Project, error) {
	return nil, nil
}

type mockMachineManager struct {
	createFn    func(name string, config fly.MachineConfig) (*fly.Machine, error)
	startFn     func(machineID string) error
	stopFn      func(machineID string) error
	deleteFn    func(machineID string) error
	waitStateFn func(machineID string, state string, timeout time.Duration) error
}

func newMockMachineManager() *mockMachineManager {
	return &mockMachineManager{}
}

func (m *mockMachineManager) CreateMachine(name string, config fly.MachineConfig) (*fly.Machine, error) {
	if m.createFn != nil {
		return m.createFn(name, config)
	}
	return &fly.Machine{ID: "machine-123", Name: name, State: "created"}, nil
}

func (m *mockMachineManager) StartMachine(machineID string) error {
	if m.startFn != nil {
		return m.startFn(machineID)
	}
	return nil
}

func (m *mockMachineManager) StopMachine(machineID string) error {
	if m.stopFn != nil {
		return m.stopFn(machineID)
	}
	return nil
}

func (m *mockMachineManager) DeleteMachine(machineID string) error {
	if m.deleteFn != nil {
		return m.deleteFn(machineID)
	}
	return nil
}

func (m *mockMachineManager) WaitForState(machineID string, state string, timeout time.Duration) error {
	if m.waitStateFn != nil {
		return m.waitStateFn(machineID, state, timeout)
	}
	return nil
}

// Helper to create request with user context
func newAuthenticatedRequest(method, path string, body []byte) *http.Request {
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	// Add user ID to context (simulating auth middleware)
	ctx := context.WithValue(req.Context(), authmw.UserIDKey, "test-user-id")
	return req.WithContext(ctx)
}

// Tests

func TestProjectHandler_List(t *testing.T) {
	store := newMockStore()
	store.projects["p1"] = &db.Project{
		ID:        "p1",
		UserID:    "test-user-id",
		Name:      "Project One",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	store.projects["p2"] = &db.Project{
		ID:        "p2",
		UserID:    "test-user-id",
		Name:      "Project Two",
		Status:    "running",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("GET", "/projects", nil)
	rr := httptest.NewRecorder()

	handler.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var response ProjectListResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(response.Projects) != 2 {
		t.Errorf("expected 2 projects, got %d", len(response.Projects))
	}
}

func TestProjectHandler_Create_Valid(t *testing.T) {
	store := newMockStore()
	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	body := []byte(`{"name": "my-project", "description": "A test project"}`)
	req := newAuthenticatedRequest("POST", "/projects", body)
	rr := httptest.NewRecorder()

	handler.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status %d, got %d: %s", http.StatusCreated, rr.Code, rr.Body.String())
	}

	var response ProjectResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Name != "my-project" {
		t.Errorf("expected name 'my-project', got %s", response.Name)
	}

	if response.Status != "stopped" {
		t.Errorf("expected status 'stopped', got %s", response.Status)
	}
}

func TestProjectHandler_Create_InvalidName(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode int
	}{
		{"empty name", `{"name": ""}`, http.StatusBadRequest},
		{"starts with dash", `{"name": "-invalid"}`, http.StatusBadRequest},
		{"invalid body", `{invalid json}`, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newMockStore()
			handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

			req := newAuthenticatedRequest("POST", "/projects", []byte(tt.body))
			rr := httptest.NewRecorder()

			handler.Create(rr, req)

			if rr.Code != tt.wantCode {
				t.Errorf("expected status %d, got %d: %s", tt.wantCode, rr.Code, rr.Body.String())
			}
		})
	}
}

func TestProjectHandler_Get_Found(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	store.projects[projectID] = &db.Project{
		ID:        projectID,
		UserID:    "test-user-id",
		Name:      "My Project",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("GET", "/projects/"+projectID, nil)
	rr := httptest.NewRecorder()

	// Use chi router to extract URL params
	router := chi.NewRouter()
	router.Get("/projects/{id}", handler.Get)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d: %s", http.StatusOK, rr.Code, rr.Body.String())
	}
}

func TestProjectHandler_Get_NotFound(t *testing.T) {
	store := newMockStore()
	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("GET", "/projects/550e8400-e29b-41d4-a716-446655440000", nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Get("/projects/{id}", handler.Get)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected status %d, got %d: %s", http.StatusNotFound, rr.Code, rr.Body.String())
	}
}

func TestProjectHandler_Get_InvalidUUID(t *testing.T) {
	store := newMockStore()
	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("GET", "/projects/not-a-uuid", nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Get("/projects/{id}", handler.Get)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d: %s", http.StatusBadRequest, rr.Code, rr.Body.String())
	}
}

func TestProjectHandler_Update(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	store.projects[projectID] = &db.Project{
		ID:        projectID,
		UserID:    "test-user-id",
		Name:      "Old Name",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	body := []byte(`{"name": "new-name"}`)
	req := newAuthenticatedRequest("PATCH", "/projects/"+projectID, body)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Patch("/projects/{id}", handler.Update)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d: %s", http.StatusOK, rr.Code, rr.Body.String())
	}

	var response ProjectResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Name != "new-name" {
		t.Errorf("expected name 'new-name', got %s", response.Name)
	}
}

func TestProjectHandler_Delete(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	store.projects[projectID] = &db.Project{
		ID:        projectID,
		UserID:    "test-user-id",
		Name:      "To Delete",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("DELETE", "/projects/"+projectID, nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Delete("/projects/{id}", handler.Delete)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("expected status %d, got %d: %s", http.StatusNoContent, rr.Code, rr.Body.String())
	}

	if _, ok := store.projects[projectID]; ok {
		t.Error("project should have been deleted")
	}
}

func TestProjectHandler_Start(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	store.projects[projectID] = &db.Project{
		ID:        projectID,
		UserID:    "test-user-id",
		Name:      "My Project",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	machines := newMockMachineManager()
	handler := NewProjectHandler(store, machines, "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("POST", "/projects/"+projectID+"/start", nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Post("/projects/{id}/start", handler.Start)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d: %s", http.StatusOK, rr.Code, rr.Body.String())
	}

	var response StartResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Status != "running" {
		t.Errorf("expected status 'running', got %s", response.Status)
	}
}

func TestProjectHandler_Stop(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	machineID := "machine-123"
	store.projects[projectID] = &db.Project{
		ID:           projectID,
		UserID:       "test-user-id",
		Name:         "My Project",
		Status:       "running",
		FlyMachineID: &machineID,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	machines := newMockMachineManager()
	handler := NewProjectHandler(store, machines, "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("POST", "/projects/"+projectID+"/stop", nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Post("/projects/{id}/stop", handler.Stop)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d: %s", http.StatusOK, rr.Code, rr.Body.String())
	}

	var response StopResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Status != "stopped" {
		t.Errorf("expected status 'stopped', got %s", response.Status)
	}
}

func TestProjectHandler_Stop_NoMachine(t *testing.T) {
	store := newMockStore()
	projectID := "550e8400-e29b-41d4-a716-446655440000"
	store.projects[projectID] = &db.Project{
		ID:        projectID,
		UserID:    "test-user-id",
		Name:      "My Project",
		Status:    "stopped",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	handler := NewProjectHandler(store, newMockMachineManager(), "test-image", 10*time.Minute)

	req := newAuthenticatedRequest("POST", "/projects/"+projectID+"/stop", nil)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Post("/projects/{id}/stop", handler.Stop)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d: %s", http.StatusBadRequest, rr.Code, rr.Body.String())
	}
}
