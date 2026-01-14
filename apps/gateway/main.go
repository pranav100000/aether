package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"aether/apps/gateway/proxy"

	"aether/apps/api/db"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	"aether/apps/api/local"
	"aether/libs/go/logging"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env file if present
	if err := godotenv.Load(); err != nil {
		// Try parent directory (for local dev)
		godotenv.Load("../.env")
	}

	// Initialize logging
	logging.Init()
	logger := logging.Default()

	// Check if running in local mode
	localMode := os.Getenv("LOCAL_MODE") == "true"

	// Required environment variables
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		logger.Error("DATABASE_URL environment variable is required")
		os.Exit(1)
	}

	// Optional environment variables with defaults
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	previewDomain := os.Getenv("PREVIEW_DOMAIN")
	if previewDomain == "" {
		previewDomain = "localhost" // Default for local dev
	}

	// Initialize database client
	logger.Info("connecting to database")
	dbClient, err := db.NewClient(databaseURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer dbClient.Close()

	// Initialize machine manager based on mode
	var machines handlers.MachineManager
	if localMode {
		logger.Info("running in LOCAL_MODE - using Docker containers")
		machines = local.NewMachineManager()
	} else {
		// Production mode - require Fly.io credentials
		flyToken := os.Getenv("FLY_API_TOKEN")
		if flyToken == "" {
			logger.Error("FLY_API_TOKEN environment variable is required")
			os.Exit(1)
		}

		flyAppName := os.Getenv("FLY_VMS_APP_NAME")
		if flyAppName == "" {
			logger.Error("FLY_VMS_APP_NAME environment variable is required")
			os.Exit(1)
		}

		flyRegion := os.Getenv("FLY_REGION")
		if flyRegion == "" {
			flyRegion = "sjc"
		}

		logger.Info("running in production mode - using Fly.io")
		machines = fly.NewClient(flyToken, flyAppName, flyRegion)
	}

	// Create proxy handler
	handler := proxy.NewHandler(dbClient, machines, previewDomain, logger)

	// Create HTTP server
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second, // Longer for proxied requests
		IdleTimeout:  120 * time.Second,
	}

	// Start server in background
	go func() {
		logger.Info("gateway starting", "port", port, "preview_domain", previewDomain)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("server stopped")
}
