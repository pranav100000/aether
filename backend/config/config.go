package config

import (
	"os"
	"sync"
)

var (
	once   sync.Once
	config *Config
)

type Config struct {
	LocalMode               bool
	LocalProjectDir         string
	LocalBaseImage          string
	LocalWorkspaceServiceDir string
}

// Get returns the singleton config instance
func Get() *Config {
	once.Do(func() {
		config = &Config{
			LocalMode:               os.Getenv("LOCAL_MODE") == "true",
			LocalProjectDir:         getEnv("LOCAL_PROJECT_DIR", "/tmp/aether-project"),
			LocalBaseImage:          os.Getenv("LOCAL_BASE_IMAGE"), // Same image as production (e.g., pranav100000/aether-base:latest)
			LocalWorkspaceServiceDir: os.Getenv("LOCAL_WORKSPACE_SERVICE_DIR"),
		}
	})
	return config
}

// IsLocalMode returns true if LOCAL_MODE is enabled
func IsLocalMode() bool {
	return Get().LocalMode
}

// GetLocalProjectDir returns the local project directory path
func GetLocalProjectDir() string {
	return Get().LocalProjectDir
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
