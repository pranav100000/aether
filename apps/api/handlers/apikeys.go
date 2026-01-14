package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"path"
	"strings"
	"time"

	"aether/apps/api/crypto"
	"aether/apps/api/middleware"
)

// Supported providers
var supportedProviders = map[string]string{
	"anthropic":  "ANTHROPIC_API_KEY",
	"openai":     "OPENAI_API_KEY",
	"openrouter": "OPENROUTER_API_KEY",
}

// APIKeysStore interface for database operations
type APIKeysStore interface {
	GetUserAPIKeys(ctx context.Context, userID string) (*string, error)
	SetUserAPIKeys(ctx context.Context, userID string, encrypted *string) error
}

// APIKeysHandler handles API key management
type APIKeysHandler struct {
	db        APIKeysStore
	encryptor *crypto.Encryptor
}

// NewAPIKeysHandler creates a new API keys handler
func NewAPIKeysHandler(db APIKeysStore, encryptor *crypto.Encryptor) *APIKeysHandler {
	return &APIKeysHandler{
		db:        db,
		encryptor: encryptor,
	}
}

// ConnectedProvider represents a provider's connection status
type ConnectedProvider struct {
	Provider  string     `json:"provider"`
	Connected bool       `json:"connected"`
	AddedAt   *time.Time `json:"added_at,omitempty"`
}

// ListProvidersResponse is the response for GET /user/api-keys
type ListProvidersResponse struct {
	Providers []ConnectedProvider `json:"providers"`
}

// AddKeyRequest is the request body for POST /user/api-keys
type AddKeyRequest struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
}

// StoredKeys is the internal structure for storing encrypted keys
type StoredKeys struct {
	Keys map[string]StoredKey `json:"keys"`
}

// StoredKey represents a single stored API key
type StoredKey struct {
	Key     string    `json:"key"`
	AddedAt time.Time `json:"added_at"`
}

// List returns the list of connected providers (without exposing actual keys)
func (h *APIKeysHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// Get encrypted keys from database
	encryptedKeys, err := h.db.GetUserAPIKeys(ctx, userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch api keys"})
		return
	}

	// Parse stored keys
	storedKeys := &StoredKeys{Keys: make(map[string]StoredKey)}
	if encryptedKeys != nil && *encryptedKeys != "" {
		decrypted, err := h.encryptor.Decrypt(*encryptedKeys, userID)
		if err == nil {
			json.Unmarshal([]byte(decrypted), storedKeys)
		}
	}

	// Build response
	providers := make([]ConnectedProvider, 0, len(supportedProviders))
	for provider := range supportedProviders {
		cp := ConnectedProvider{
			Provider:  provider,
			Connected: false,
		}
		if stored, ok := storedKeys.Keys[provider]; ok {
			cp.Connected = true
			cp.AddedAt = &stored.AddedAt
		}
		providers = append(providers, cp)
	}

	WriteJSON(w, http.StatusOK, ListProvidersResponse{Providers: providers})
}

// Add adds or updates an API key for a provider
func (h *APIKeysHandler) Add(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req AddKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	// Validate provider
	req.Provider = strings.ToLower(req.Provider)
	if _, ok := supportedProviders[req.Provider]; !ok {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported provider"})
		return
	}

	// Validate API key is not empty
	if strings.TrimSpace(req.APIKey) == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "api_key is required"})
		return
	}

	// Get existing keys
	encryptedKeys, err := h.db.GetUserAPIKeys(ctx, userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch api keys"})
		return
	}

	// Parse existing keys
	storedKeys := &StoredKeys{Keys: make(map[string]StoredKey)}
	if encryptedKeys != nil && *encryptedKeys != "" {
		decrypted, err := h.encryptor.Decrypt(*encryptedKeys, userID)
		if err == nil {
			json.Unmarshal([]byte(decrypted), storedKeys)
		}
	}

	// Add/update the key
	now := time.Now().UTC()
	storedKeys.Keys[req.Provider] = StoredKey{
		Key:     req.APIKey,
		AddedAt: now,
	}

	// Encrypt and save
	keysJSON, err := json.Marshal(storedKeys)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to serialize keys"})
		return
	}

	encrypted, err := h.encryptor.Encrypt(string(keysJSON), userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to encrypt keys"})
		return
	}

	if err := h.db.SetUserAPIKeys(ctx, userID, &encrypted); err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save api keys"})
		return
	}

	WriteJSON(w, http.StatusOK, ConnectedProvider{
		Provider:  req.Provider,
		Connected: true,
		AddedAt:   &now,
	})
}

// Remove removes an API key for a provider
func (h *APIKeysHandler) Remove(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// Extract provider from URL path
	// Expected path: /user/api-keys/{provider}
	provider := strings.ToLower(path.Base(strings.TrimSuffix(r.URL.Path, "/")))

	// Validate provider
	if _, ok := supportedProviders[provider]; !ok {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported provider"})
		return
	}

	// Get existing keys
	encryptedKeys, err := h.db.GetUserAPIKeys(ctx, userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch api keys"})
		return
	}

	// Parse existing keys
	storedKeys := &StoredKeys{Keys: make(map[string]StoredKey)}
	if encryptedKeys != nil && *encryptedKeys != "" {
		decrypted, err := h.encryptor.Decrypt(*encryptedKeys, userID)
		if err == nil {
			json.Unmarshal([]byte(decrypted), storedKeys)
		}
	}

	// Check if provider exists
	if _, ok := storedKeys.Keys[provider]; !ok {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "provider not connected"})
		return
	}

	// Remove the key
	delete(storedKeys.Keys, provider)

	// Encrypt and save
	var encrypted *string
	if len(storedKeys.Keys) > 0 {
		keysJSON, err := json.Marshal(storedKeys)
		if err != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to serialize keys"})
			return
		}

		enc, err := h.encryptor.Encrypt(string(keysJSON), userID)
		if err != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to encrypt keys"})
			return
		}
		encrypted = &enc
	}

	if err := h.db.SetUserAPIKeys(ctx, userID, encrypted); err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save api keys"})
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetDecryptedKeys returns the decrypted API keys as environment variable map
// This is used internally when starting a VM to inject keys
func (h *APIKeysHandler) GetDecryptedKeys(ctx context.Context, userID string) (map[string]string, error) {
	encryptedKeys, err := h.db.GetUserAPIKeys(ctx, userID)
	if err != nil {
		return nil, err
	}

	if encryptedKeys == nil || *encryptedKeys == "" {
		return nil, nil
	}

	decrypted, err := h.encryptor.Decrypt(*encryptedKeys, userID)
	if err != nil {
		return nil, err
	}

	var storedKeys StoredKeys
	if err := json.Unmarshal([]byte(decrypted), &storedKeys); err != nil {
		return nil, err
	}

	// Convert to env var format
	result := make(map[string]string)
	for provider, stored := range storedKeys.Keys {
		if envName, ok := supportedProviders[provider]; ok {
			result[envName] = stored.Key
		}
	}

	return result, nil
}
