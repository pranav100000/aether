package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"aether/fly"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type MachineState struct {
	ID           string    `json:"id"`
	FlyMachineID string    `json:"fly_machine_id"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	PrivateIP    string    `json:"private_ip"`
	CreatedAt    time.Time `json:"created_at"`
	LastActivity time.Time `json:"last_activity"`
}

type MachineHandler struct {
	flyClient    *fly.Client
	machines     map[string]*MachineState
	mu           sync.RWMutex
	idleTimeout  time.Duration
	baseImage    string
	stopChan     chan struct{}
}

func NewMachineHandler(flyClient *fly.Client, baseImage string, idleTimeout time.Duration) *MachineHandler {
	h := &MachineHandler{
		flyClient:   flyClient,
		machines:    make(map[string]*MachineState),
		idleTimeout: idleTimeout,
		baseImage:   baseImage,
		stopChan:    make(chan struct{}),
	}

	h.recoverMachines()
	go h.idleChecker()

	return h
}

func (h *MachineHandler) recoverMachines() {
	machines, err := h.flyClient.ListMachines()
	if err != nil {
		log.Printf("Failed to recover machines from Fly: %v", err)
		return
	}

	for _, m := range machines {
		if m.State == "destroyed" {
			continue
		}

		state := &MachineState{
			ID:           m.ID, // Use Fly machine ID as our ID for recovered machines
			FlyMachineID: m.ID,
			Name:         m.Name,
			Status:       m.State,
			PrivateIP:    m.PrivateIP,
			CreatedAt:    time.Now(), // We don't have the original creation time
			LastActivity: time.Now(),
		}

		h.machines[m.ID] = state
		log.Printf("Recovered machine: %s (%s) - %s", m.Name, m.ID, m.State)
	}

	log.Printf("Recovered %d machines from Fly", len(h.machines))
}

func (h *MachineHandler) idleChecker() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			h.checkIdleMachines()
		case <-h.stopChan:
			return
		}
	}
}

func (h *MachineHandler) checkIdleMachines() {
	h.mu.RLock()
	var toStop []string
	for id, m := range h.machines {
		if m.Status == "running" && time.Since(m.LastActivity) > h.idleTimeout {
			toStop = append(toStop, id)
		}
	}
	h.mu.RUnlock()

	for _, id := range toStop {
		log.Printf("Stopping idle machine: %s", id)
		h.mu.RLock()
		m := h.machines[id]
		h.mu.RUnlock()

		if m != nil {
			if err := h.flyClient.StopMachine(m.FlyMachineID); err != nil {
				log.Printf("Error stopping idle machine %s: %v", id, err)
			} else {
				h.mu.Lock()
				if h.machines[id] != nil {
					h.machines[id].Status = "stopped"
				}
				h.mu.Unlock()
			}
		}
	}
}

func (h *MachineHandler) UpdateActivity(machineID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if m, ok := h.machines[machineID]; ok {
		m.LastActivity = time.Now()
	}
}

func (h *MachineHandler) GetMachineState(machineID string) *MachineState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.machines[machineID]
}

func (h *MachineHandler) RefreshMachineStatus(machineID string) {
	h.mu.RLock()
	state, ok := h.machines[machineID]
	h.mu.RUnlock()

	if !ok || state == nil {
		return
	}

	flyMachine, err := h.flyClient.GetMachine(state.FlyMachineID)
	if err != nil {
		log.Printf("Error refreshing machine status: %v", err)
		return
	}

	h.mu.Lock()
	state.Status = flyMachine.State
	state.PrivateIP = flyMachine.PrivateIP
	h.mu.Unlock()
}

func (h *MachineHandler) Close() {
	close(h.stopChan)
}

type CreateMachineRequest struct {
	Name string `json:"name"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func (h *MachineHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateMachineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
		return
	}

	if req.Name == "" {
		req.Name = "aether-" + uuid.New().String()[:8]
	}

	config := fly.MachineConfig{
		Image: h.baseImage,
		Guest: fly.GuestConfig{
			CPUKind:  "shared",
			CPUs:     1,
			MemoryMB: 512,
		},
		Services: []fly.Service{
			{
				Protocol:     "tcp",
				InternalPort: 22,
				Ports: []fly.Port{
					{Port: 22, Handlers: []string{}},
				},
			},
		},
	}

	flyMachine, err := h.flyClient.CreateMachine(req.Name, config)
	if err != nil {
		log.Printf("Error creating machine: %v", err)
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "failed to create machine"})
		return
	}

	id := uuid.New().String()
	now := time.Now()

	state := &MachineState{
		ID:           id,
		FlyMachineID: flyMachine.ID,
		Name:         req.Name,
		Status:       flyMachine.State,
		PrivateIP:    flyMachine.PrivateIP,
		CreatedAt:    now,
		LastActivity: now,
	}

	h.mu.Lock()
	h.machines[id] = state
	h.mu.Unlock()

	writeJSON(w, http.StatusCreated, state)
}

func (h *MachineHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	h.mu.RLock()
	state, ok := h.machines[id]
	h.mu.RUnlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "machine not found"})
		return
	}

	flyMachine, err := h.flyClient.GetMachine(state.FlyMachineID)
	if err != nil {
		log.Printf("Error getting machine status: %v", err)
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "failed to get machine status"})
		return
	}

	h.mu.Lock()
	state.Status = flyMachine.State
	state.PrivateIP = flyMachine.PrivateIP
	h.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (h *MachineHandler) List(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	machines := make([]*MachineState, 0, len(h.machines))
	for _, m := range h.machines {
		machines = append(machines, m)
	}
	h.mu.RUnlock()

	writeJSON(w, http.StatusOK, machines)
}

func (h *MachineHandler) Start(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	h.mu.RLock()
	state, ok := h.machines[id]
	h.mu.RUnlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "machine not found"})
		return
	}

	if err := h.flyClient.StartMachine(state.FlyMachineID); err != nil {
		log.Printf("Error starting machine: %v", err)
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "failed to start machine"})
		return
	}

	if err := h.flyClient.WaitForState(state.FlyMachineID, "started", 30*time.Second); err != nil {
		log.Printf("Error waiting for machine to start: %v", err)
	}

	flyMachine, _ := h.flyClient.GetMachine(state.FlyMachineID)
	if flyMachine != nil {
		h.mu.Lock()
		state.Status = flyMachine.State
		state.PrivateIP = flyMachine.PrivateIP
		state.LastActivity = time.Now()
		h.mu.Unlock()
	}

	writeJSON(w, http.StatusOK, state)
}

func (h *MachineHandler) Stop(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	h.mu.RLock()
	state, ok := h.machines[id]
	h.mu.RUnlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "machine not found"})
		return
	}

	if err := h.flyClient.StopMachine(state.FlyMachineID); err != nil {
		log.Printf("Error stopping machine: %v", err)
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "failed to stop machine"})
		return
	}

	h.mu.Lock()
	state.Status = "stopped"
	h.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (h *MachineHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	h.mu.RLock()
	state, ok := h.machines[id]
	h.mu.RUnlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "machine not found"})
		return
	}

	if err := h.flyClient.DeleteMachine(state.FlyMachineID); err != nil {
		log.Printf("Error deleting machine: %v", err)
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "failed to delete machine"})
		return
	}

	h.mu.Lock()
	delete(h.machines, id)
	h.mu.Unlock()

	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
