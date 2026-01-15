package config

import (
	"encoding/hex"
	"errors"
	"os"
	"strconv"

	"aether/libs/go/logging"
)

// ValidationError represents a fatal configuration error
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	return e.Field + ": " + e.Message
}

// ValidateStartupConfig checks for configuration inconsistencies and required values.
// Called once at startup after logger init. Logs warnings for non-fatal issues
// and returns an error for fatal misconfigurations.
func ValidateStartupConfig(logger *logging.Logger) error {
	cfg := Get()
	var errs []ValidationError

	// Always required
	if os.Getenv("DATABASE_URL") == "" {
		errs = append(errs, ValidationError{
			Field:   "DATABASE_URL",
			Message: "required environment variable not set",
		})
	}

	if os.Getenv("SUPABASE_URL") == "" {
		errs = append(errs, ValidationError{
			Field:   "SUPABASE_URL",
			Message: "required environment variable not set",
		})
	}

	if cfg.LocalMode {
		// Local mode validations
		if os.Getenv("FLY_API_TOKEN") != "" {
			logger.Warn("FLY_API_TOKEN is set but will be ignored in LOCAL_MODE")
		}

		if cfg.LocalProjectDir == "" || cfg.LocalProjectDir == "/tmp/aether-project" {
			logger.Warn("LOCAL_PROJECT_DIR not set, using default /tmp/aether-project")
		}

		if cfg.LocalBaseImage == "" {
			errs = append(errs, ValidationError{
				Field:   "LOCAL_BASE_IMAGE",
				Message: "required when LOCAL_MODE=true (e.g., pranav100000/aether-base:latest)",
			})
		}
	} else {
		// Production mode validations
		if os.Getenv("FLY_API_TOKEN") == "" {
			errs = append(errs, ValidationError{
				Field:   "FLY_API_TOKEN",
				Message: "required when LOCAL_MODE is not enabled",
			})
		}

		if os.Getenv("FLY_VMS_APP_NAME") == "" {
			errs = append(errs, ValidationError{
				Field:   "FLY_VMS_APP_NAME",
				Message: "required when LOCAL_MODE is not enabled",
			})
		}
	}

	// Optional but validate format if set
	if key := os.Getenv("ENCRYPTION_MASTER_KEY"); key != "" {
		if _, err := hex.DecodeString(key); err != nil {
			errs = append(errs, ValidationError{
				Field:   "ENCRYPTION_MASTER_KEY",
				Message: "must be a valid hex string",
			})
		} else if len(key) != 64 {
			errs = append(errs, ValidationError{
				Field:   "ENCRYPTION_MASTER_KEY",
				Message: "must be exactly 64 hex characters (32 bytes)",
			})
		}
	}

	if timeout := os.Getenv("IDLE_TIMEOUT_MINUTES"); timeout != "" {
		if _, err := strconv.Atoi(timeout); err != nil {
			logger.Warn("IDLE_TIMEOUT_MINUTES is not a valid integer, using default",
				"value", timeout,
				"default", 10,
			)
		}
	}

	if len(errs) > 0 {
		// Log all errors for visibility
		for _, e := range errs {
			logger.Error("configuration error", "field", e.Field, "message", e.Message)
		}
		return errors.New("startup validation failed: " + strconv.Itoa(len(errs)) + " configuration error(s)")
	}

	logger.Info("startup configuration validated")
	return nil
}
