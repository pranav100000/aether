package fly

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListMachines(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/apps/test-app/machines" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing or incorrect auth header")
		}

		machines := []Machine{
			{ID: "m1", Name: "machine-1", State: "started", PrivateIP: "10.0.0.1"},
			{ID: "m2", Name: "machine-2", State: "stopped", PrivateIP: "10.0.0.2"},
		}
		json.NewEncoder(w).Encode(machines)
	}))
	defer server.Close()

	client := &Client{
		token:   "test-token",
		appName: "test-app",
		region:  "sjc",
		http:    server.Client(),
	}

	// Override baseURL for testing
	originalBaseURL := baseURL
	baseURL = server.URL + "/v1"
	defer func() { baseURL = originalBaseURL }()

	machines, err := client.ListMachines()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(machines) != 2 {
		t.Errorf("expected 2 machines, got %d", len(machines))
	}

	if machines[0].ID != "m1" || machines[0].State != "started" {
		t.Errorf("unexpected machine data: %+v", machines[0])
	}
}

func TestCreateMachine(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}

		var req CreateMachineRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}

		if req.Name != "test-machine" {
			t.Errorf("expected name 'test-machine', got %s", req.Name)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Machine{
			ID:        "new-id",
			Name:      req.Name,
			State:     "created",
			PrivateIP: "10.0.0.3",
		})
	}))
	defer server.Close()

	client := &Client{
		token:   "test-token",
		appName: "test-app",
		region:  "sjc",
		http:    server.Client(),
	}

	originalBaseURL := baseURL
	baseURL = server.URL + "/v1"
	defer func() { baseURL = originalBaseURL }()

	machine, err := client.CreateMachine("test-machine", MachineConfig{
		Image: "test-image",
		Guest: GuestConfig{CPUKind: "shared", CPUs: 1, MemoryMB: 256},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if machine.ID != "new-id" {
		t.Errorf("expected ID 'new-id', got %s", machine.ID)
	}
}

func TestAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(APIError{Error: "not_found", Message: "machine not found"})
	}))
	defer server.Close()

	client := &Client{
		token:   "test-token",
		appName: "test-app",
		region:  "sjc",
		http:    server.Client(),
	}

	originalBaseURL := baseURL
	baseURL = server.URL + "/v1"
	defer func() { baseURL = originalBaseURL }()

	_, err := client.GetMachine("nonexistent")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}
