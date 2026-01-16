package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"aether/apps/api/crypto"
	"aether/apps/api/db"
	authmw "aether/apps/api/middleware"
	"aether/libs/go/logging"

	"github.com/go-chi/chi/v5"
)

// InfraHandler handles infrastructure service endpoints
type InfraHandler struct {
	store        InfraServiceStore
	projectStore ProjectStore
	manager      InfraServiceManager
	registry     ServiceRegistry
	encryptor    *crypto.Encryptor
}

// NewInfraHandler creates a new infrastructure handler
func NewInfraHandler(
	store InfraServiceStore,
	projectStore ProjectStore,
	manager InfraServiceManager,
	registry ServiceRegistry,
	encryptor *crypto.Encryptor,
) *InfraHandler {
	return &InfraHandler{
		store:        store,
		projectStore: projectStore,
		manager:      manager,
		registry:     registry,
		encryptor:    encryptor,
	}
}

// Request/Response types

type ProvisionInfraRequest struct {
	ServiceType string                 `json:"service_type"`
	Name        string                 `json:"name,omitempty"`
	Config      map[string]interface{} `json:"config,omitempty"`
}

type InfraServiceResponse struct {
	ID          string              `json:"id"`
	ProjectID   string              `json:"project_id"`
	ServiceType string              `json:"service_type"`
	Name        *string             `json:"name,omitempty"`
	Status      string              `json:"status"`
	Connection  *ConnectionDetails  `json:"connection,omitempty"`
	ErrorMessage *string            `json:"error_message,omitempty"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
}

type InfraListResponse struct {
	Services []InfraServiceResponse `json:"services"`
}

type ServiceDefinitionResponse struct {
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	Available   bool   `json:"available"`
}

type ServiceTypesResponse struct {
	Services []ServiceDefinitionResponse `json:"services"`
}

// Helper to convert db.InfraService to response
func (h *InfraHandler) infraServiceToResponse(ctx context.Context, s *db.InfraService) InfraServiceResponse {
	log := logging.FromContext(ctx)

	resp := InfraServiceResponse{
		ID:           s.ID,
		ProjectID:    s.ProjectID,
		ServiceType:  s.ServiceType,
		Name:         s.Name,
		Status:       s.Status,
		ErrorMessage: s.ErrorMessage,
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
	}

	// Decrypt connection details if present and service is ready
	// Uses project ID as encryption scope since services are project-scoped
	if s.Status == "ready" && s.ConnectionDetailsEncrypted != nil && h.encryptor != nil {
		decrypted, err := h.encryptor.Decrypt(*s.ConnectionDetailsEncrypted, s.ProjectID)
		if err != nil {
			log.Error("failed to decrypt connection details", "service_id", s.ID, "error", err)
		} else {
			var conn ConnectionDetails
			if err := json.Unmarshal([]byte(decrypted), &conn); err != nil {
				log.Error("failed to unmarshal connection details", "service_id", s.ID, "error", err)
			} else {
				resp.Connection = &conn
			}
		}
	}

	return resp
}

// Handlers

// List returns all infrastructure services for a project
func (h *InfraHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := authmw.GetUserID(ctx)
	projectID := chi.URLParam(r, "id")
	log := logging.FromContext(ctx)

	// Verify project ownership
	_, err := h.projectStore.GetProjectByUser(ctx, projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Error("failed to get project", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	services, err := h.store.ListInfraServices(ctx, projectID)
	if err != nil {
		log.Error("failed to list infra services", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to list services")
		return
	}

	response := InfraListResponse{Services: make([]InfraServiceResponse, len(services))}
	for i, s := range services {
		response.Services[i] = h.infraServiceToResponse(ctx, &s)
	}

	WriteJSON(w, http.StatusOK, response)
}

// Get returns a specific infrastructure service
func (h *InfraHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := authmw.GetUserID(ctx)
	projectID := chi.URLParam(r, "id")
	serviceID := chi.URLParam(r, "serviceId")
	log := logging.FromContext(ctx)

	// Verify project ownership
	_, err := h.projectStore.GetProjectByUser(ctx, projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Error("failed to get project", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	service, err := h.store.GetInfraServiceByProject(ctx, serviceID, projectID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Service not found")
			return
		}
		log.Error("failed to get infra service", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get service")
		return
	}

	WriteJSON(w, http.StatusOK, h.infraServiceToResponse(ctx, service))
}

// Provision creates a new infrastructure service
func (h *InfraHandler) Provision(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := authmw.GetUserID(ctx)
	projectID := chi.URLParam(r, "id")
	log := logging.FromContext(ctx)

	// Verify project ownership
	project, err := h.projectStore.GetProjectByUser(ctx, projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Error("failed to get project", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	var req ProvisionInfraRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Error("failed to decode provision request", "error", err)
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	log.Info("provision infra request", "project_id", projectID, "service_type", req.ServiceType, "name", req.Name)

	// Validate service type
	if !h.registry.IsAvailable(req.ServiceType) {
		WriteError(w, http.StatusBadRequest, "Invalid service type: "+req.ServiceType)
		return
	}

	// Check if service of this type already exists for the project
	existing, err := h.store.ListInfraServices(ctx, projectID)
	if err != nil {
		log.Error("failed to check existing services", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to check existing services")
		return
	}
	for _, s := range existing {
		if s.ServiceType == req.ServiceType && s.Status != "deleted" && s.Status != "error" {
			WriteError(w, http.StatusConflict, "Service of type "+req.ServiceType+" already exists for this project")
			return
		}
	}

	// Create service record in database
	var name *string
	if req.Name != "" {
		name = &req.Name
	}
	service, err := h.store.CreateInfraService(ctx, projectID, req.ServiceType, name, req.Config)
	if err != nil {
		log.Error("failed to create infra service record", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to create service")
		return
	}

	log.Info("created infra service record", "service_id", service.ID, "service_type", req.ServiceType)

	// Start async provisioning
	go h.provisionServiceAsync(context.Background(), project, service, req.ServiceType)

	// Return immediately with provisioning status
	WriteJSON(w, http.StatusAccepted, h.infraServiceToResponse(ctx, service))
}

// provisionServiceAsync handles the async provisioning of infrastructure
func (h *InfraHandler) provisionServiceAsync(ctx context.Context, project *db.Project, service *db.InfraService, serviceType string) {
	log := logging.FromContext(ctx).With("service_id", service.ID, "service_type", serviceType)
	log.Info("starting async infrastructure provisioning")

	// Use the manager to provision
	result, err := h.manager.Provision(ctx, project.ID, serviceType, "", nil)
	if err != nil {
		log.Error("failed to provision infrastructure", "error", err)
		errMsg := err.Error()
		if updateErr := h.store.UpdateInfraServiceStatus(ctx, service.ID, "error", &errMsg); updateErr != nil {
			log.Error("failed to update service status to error", "error", updateErr)
		}
		return
	}

	// Update database with machine/volume IDs
	if result.MachineID != "" {
		if err := h.store.UpdateInfraServiceMachine(ctx, service.ID, result.MachineID); err != nil {
			log.Error("failed to update machine ID", "error", err)
		}
	}
	if result.VolumeID != "" {
		if err := h.store.UpdateInfraServiceVolume(ctx, service.ID, result.VolumeID); err != nil {
			log.Error("failed to update volume ID", "error", err)
		}
	}

	// Encrypt and store connection details
	// Uses project ID as encryption scope since services are project-scoped
	if result.Connection != nil && h.encryptor != nil {
		connJSON, err := json.Marshal(result.Connection)
		if err != nil {
			log.Error("failed to marshal connection details", "error", err)
		} else {
			encrypted, err := h.encryptor.Encrypt(string(connJSON), project.ID)
			if err != nil {
				log.Error("failed to encrypt connection details", "error", err)
			} else {
				if err := h.store.UpdateInfraServiceConnection(ctx, service.ID, encrypted); err != nil {
					log.Error("failed to store connection details", "error", err)
				}
			}
		}
	}

	// Update status to ready
	if err := h.store.UpdateInfraServiceStatus(ctx, service.ID, "ready", nil); err != nil {
		log.Error("failed to update service status to ready", "error", err)
		return
	}

	log.Info("infrastructure provisioning completed successfully")
}

// Delete removes an infrastructure service
func (h *InfraHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := authmw.GetUserID(ctx)
	projectID := chi.URLParam(r, "id")
	serviceID := chi.URLParam(r, "serviceId")
	log := logging.FromContext(ctx)

	// Verify project ownership
	_, err := h.projectStore.GetProjectByUser(ctx, projectID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Error("failed to get project", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	service, err := h.store.GetInfraServiceByProject(ctx, serviceID, projectID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Service not found")
			return
		}
		log.Error("failed to get infra service", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get service")
		return
	}

	log.Info("deleting infra service", "service_id", serviceID, "service_type", service.ServiceType)

	// Delete the actual infrastructure
	if err := h.manager.Delete(ctx, serviceID); err != nil {
		log.Error("failed to delete infrastructure", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to delete service infrastructure")
		return
	}

	// Mark as deleted in database
	if err := h.store.DeleteInfraService(ctx, serviceID); err != nil {
		log.Error("failed to mark service as deleted", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to delete service record")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListServiceTypes returns available service types
func (h *InfraHandler) ListServiceTypes(w http.ResponseWriter, r *http.Request) {
	definitions := h.registry.List()

	response := ServiceTypesResponse{
		Services: make([]ServiceDefinitionResponse, len(definitions)),
	}

	for i, def := range definitions {
		response.Services[i] = ServiceDefinitionResponse{
			Type:        def.Type,
			DisplayName: def.DisplayName,
			Description: def.Description,
			Available:   true, // All registered services are available
		}
	}

	WriteJSON(w, http.StatusOK, response)
}

// InternalProvision handles provisioning requests from within the workspace
// This endpoint uses project ID from the request rather than auth
func (h *InfraHandler) InternalProvision(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	projectID := chi.URLParam(r, "id")
	log := logging.FromContext(ctx)

	var req ProvisionInfraRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Error("failed to decode provision request", "error", err)
		WriteError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	log.Info("internal provision infra request", "project_id", projectID, "service_type", req.ServiceType)

	// Get project (no user check for internal endpoint)
	project, err := h.projectStore.GetProject(ctx, projectID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "Project not found")
			return
		}
		log.Error("failed to get project", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to get project")
		return
	}

	// Validate service type
	if !h.registry.IsAvailable(req.ServiceType) {
		WriteError(w, http.StatusBadRequest, "Invalid service type: "+req.ServiceType)
		return
	}

	// Check if service of this type already exists
	existing, err := h.store.ListInfraServices(ctx, projectID)
	if err != nil {
		log.Error("failed to check existing services", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to check existing services")
		return
	}
	for _, s := range existing {
		if s.ServiceType == req.ServiceType && s.Status != "deleted" && s.Status != "error" {
			// Return existing service instead of error
			WriteJSON(w, http.StatusOK, h.infraServiceToResponse(ctx, &s))
			return
		}
	}

	// Create service record
	var name *string
	if req.Name != "" {
		name = &req.Name
	}
	service, err := h.store.CreateInfraService(ctx, projectID, req.ServiceType, name, req.Config)
	if err != nil {
		log.Error("failed to create infra service record", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to create service")
		return
	}

	// Start async provisioning
	go h.provisionServiceAsync(context.Background(), project, service, req.ServiceType)

	WriteJSON(w, http.StatusAccepted, h.infraServiceToResponse(ctx, service))
}

// InternalList handles list requests from within the workspace
func (h *InfraHandler) InternalList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	projectID := chi.URLParam(r, "id")
	log := logging.FromContext(ctx)

	services, err := h.store.ListInfraServices(ctx, projectID)
	if err != nil {
		log.Error("failed to list infra services", "error", err)
		WriteError(w, http.StatusInternalServerError, "Failed to list services")
		return
	}

	response := InfraListResponse{Services: make([]InfraServiceResponse, len(services))}
	for i, s := range services {
		response.Services[i] = h.infraServiceToResponse(ctx, &s)
	}

	WriteJSON(w, http.StatusOK, response)
}
