package handlers

import (
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// SessionClaims represents the claims in an agent session token
type SessionClaims struct {
	UserID    string `json:"user_id"`
	ProjectID string `json:"project_id"`
	jwt.RegisteredClaims
}

// GenerateSessionToken creates a short-lived JWT for agent service authentication
func GenerateSessionToken(userID, projectID string) (string, error) {
	secret := os.Getenv("AGENT_SERVICE_SECRET")
	if secret == "" {
		return "", nil // Return empty string if not configured (graceful degradation)
	}

	claims := SessionClaims{
		UserID:    userID,
		ProjectID: projectID,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.New().String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}
