package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gateway/proxy"

	"aether/db"
	"aether/fly"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env file if present
	if err := godotenv.Load(); err != nil {
		// Try parent directory (for local dev)
		godotenv.Load("../.env")
	}

	// Required environment variables
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	flyToken := os.Getenv("FLY_API_TOKEN")
	if flyToken == "" {
		log.Fatal("FLY_API_TOKEN environment variable is required")
	}

	flyAppName := os.Getenv("FLY_VMS_APP_NAME")
	if flyAppName == "" {
		log.Fatal("FLY_VMS_APP_NAME environment variable is required")
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

	flyRegion := os.Getenv("FLY_REGION")
	if flyRegion == "" {
		flyRegion = "sjc"
	}

	// Initialize database client
	log.Println("Connecting to database...")
	dbClient, err := db.NewClient(databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer dbClient.Close()

	// Initialize Fly client
	flyClient := fly.NewClient(flyToken, flyAppName, flyRegion)

	// Create proxy handler
	handler := proxy.NewHandler(dbClient, flyClient, previewDomain)

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
		log.Printf("Gateway starting on port %s", port)
		log.Printf("Preview domain: %s", previewDomain)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	log.Println("Server stopped")
}
