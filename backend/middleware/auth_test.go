package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractTokenFromRequest(t *testing.T) {
	tests := []struct {
		name      string
		headers   map[string]string
		wantToken string
	}{
		{
			name:      "bearer token in Authorization header",
			headers:   map[string]string{"Authorization": "Bearer test-token-123"},
			wantToken: "test-token-123",
		},
		{
			name:      "bearer lowercase",
			headers:   map[string]string{"Authorization": "bearer test-token-456"},
			wantToken: "test-token-456",
		},
		{
			name:      "no authorization header",
			headers:   map[string]string{},
			wantToken: "",
		},
		{
			name:      "invalid format - no bearer",
			headers:   map[string]string{"Authorization": "test-token"},
			wantToken: "",
		},
		{
			name:      "websocket subprotocol",
			headers:   map[string]string{"Sec-WebSocket-Protocol": "bearer, ws-token-789"},
			wantToken: "ws-token-789",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}

			token := ExtractTokenFromRequest(req)
			if token != tt.wantToken {
				t.Errorf("expected token %q, got %q", tt.wantToken, token)
			}
		})
	}
}

func TestGetUserID(t *testing.T) {
	t.Run("returns empty string when no user ID in context", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		userID := GetUserID(req.Context())
		if userID != "" {
			t.Errorf("expected empty string, got %q", userID)
		}
	})
}

func TestAuthenticate_MissingHeader(t *testing.T) {
	// We can't fully test Authenticate without a real JWKS endpoint,
	// but we can test the error cases

	// This test would require mocking the JWKS endpoint
	// For now, we test the extraction helper functions
	req := httptest.NewRequest("GET", "/test", nil)

	// Missing Authorization header should extract empty token
	token := ExtractTokenFromRequest(req)
	if token != "" {
		t.Errorf("expected empty token for request without auth header")
	}
}

func TestWriteAuthError(t *testing.T) {
	rr := httptest.NewRecorder()
	writeAuthError(rr, "test error message")

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}

	if rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type application/json")
	}

	expected := `{"error":"test error message"}`
	if rr.Body.String() != expected {
		t.Errorf("expected body %q, got %q", expected, rr.Body.String())
	}
}
