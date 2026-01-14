package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "user_id"

type AuthMiddleware struct {
	jwks      keyfunc.Keyfunc
	jwtSecret []byte
}

func NewAuthMiddleware(supabaseURL string, jwtSecret string) (*AuthMiddleware, error) {
	// Supabase JWKS endpoint
	jwksURL := supabaseURL + "/auth/v1/.well-known/jwks.json"

	// Create JWKS keyfunc
	jwks, err := keyfunc.NewDefault([]string{jwksURL})
	if err != nil {
		return nil, fmt.Errorf("failed to create JWKS keyfunc: %w", err)
	}

	return &AuthMiddleware{
		jwks:      jwks,
		jwtSecret: []byte(jwtSecret),
	}, nil
}

func (m *AuthMiddleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeAuthError(w, "missing authorization header")
			return
		}

		// Expect "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			writeAuthError(w, "invalid authorization header format")
			return
		}

		tokenString := parts[1]

		// Parse and validate token - try JWKS first, fall back to HS256 secret
		token, err := m.parseToken(tokenString)
		if err != nil {
			writeAuthError(w, "invalid token: "+err.Error())
			return
		}

		if !token.Valid {
			writeAuthError(w, "invalid token")
			return
		}

		// Extract user ID from claims
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeAuthError(w, "invalid token claims")
			return
		}

		// Supabase puts user ID in "sub" claim
		userID, ok := claims["sub"].(string)
		if !ok || userID == "" {
			writeAuthError(w, "invalid user id in token")
			return
		}

		// Add user ID to context
		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserID extracts the user ID from the request context
func GetUserID(ctx context.Context) string {
	userID, _ := ctx.Value(UserIDKey).(string)
	return userID
}

// ExtractTokenFromRequest extracts JWT from either Authorization header or WebSocket subprotocol
func ExtractTokenFromRequest(r *http.Request) string {
	// Try Authorization header first
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
			return parts[1]
		}
	}

	// Try WebSocket subprotocol (for terminal connections)
	// Client sends: Sec-WebSocket-Protocol: bearer, <token>
	protocols := r.Header.Get("Sec-WebSocket-Protocol")
	if protocols != "" {
		parts := strings.Split(protocols, ", ")
		for i, p := range parts {
			if p == "bearer" && i+1 < len(parts) {
				return parts[i+1]
			}
		}
	}

	return ""
}

// ValidateToken validates a JWT and returns the user ID
func (m *AuthMiddleware) ValidateToken(tokenString string) (string, error) {
	token, err := m.parseToken(tokenString)
	if err != nil {
		return "", fmt.Errorf("invalid token: %w", err)
	}

	if !token.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid token claims")
	}

	userID, ok := claims["sub"].(string)
	if !ok || userID == "" {
		return "", fmt.Errorf("invalid user id in token")
	}

	return userID, nil
}

// parseToken tries JWKS first, then falls back to HS256 secret (for local Supabase)
func (m *AuthMiddleware) parseToken(tokenString string) (*jwt.Token, error) {
	// Try JWKS first (production Supabase with asymmetric keys)
	token, err := jwt.Parse(tokenString, m.jwks.Keyfunc)
	if err == nil && token.Valid {
		return token, nil
	}

	// Fall back to HS256 secret (local Supabase uses shared secret)
	if len(m.jwtSecret) > 0 {
		token, err = jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return m.jwtSecret, nil
		})
		if err == nil && token.Valid {
			return token, nil
		}
	}

	return nil, fmt.Errorf("token validation failed")
}

func writeAuthError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, message)))
}
