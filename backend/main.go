package main

import (
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"aether/config"
	"aether/crypto"
	"aether/db"
	"aether/fly"
	"aether/handlers"
	authmw "aether/middleware"
	"aether/sftp"
	"aether/ssh"
	"aether/workspace"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file if it exists (check both current dir and parent)
	if err := godotenv.Load(); err != nil {
		if err := godotenv.Load("../.env"); err != nil {
			log.Println("No .env file found, using environment variables")
		}
	}
	port := getEnv("API_PORT", "8080")

	// Initialize config (checks LOCAL_MODE env var)
	cfg := config.Get()

	// Fly.io config (not required in local mode)
	var flyToken, flyAppName, flyRegion, baseImage string
	if !cfg.LocalMode {
		flyToken = requireEnv("FLY_API_TOKEN")
		flyAppName = requireEnv("FLY_VMS_APP_NAME")
		flyRegion = getEnv("FLY_REGION", "sjc")
		baseImage = getEnv("BASE_IMAGE", "registry.fly.io/"+flyAppName+"/base:latest")
	} else {
		flyToken = os.Getenv("FLY_API_TOKEN")
		flyAppName = os.Getenv("FLY_VMS_APP_NAME")
		flyRegion = getEnv("FLY_REGION", "sjc")
		baseImage = getEnv("BASE_IMAGE", "")
		log.Println("LOCAL_MODE enabled - Fly.io VM operations will be skipped")
		log.Printf("Local project directory: %s", cfg.LocalProjectDir)
	}
	idleTimeoutMin := getEnvInt("IDLE_TIMEOUT_MINUTES", 10)

	flyClient := fly.NewClient(flyToken, flyAppName, flyRegion)

	sshClient, err := loadSSHClient()
	if err != nil {
		log.Fatalf("Failed to load SSH client: %v", err)
	}

	// Initialize SFTP client (uses same SSH key)
	sftpClient, err := loadSFTPClient()
	if err != nil {
		log.Fatalf("Failed to load SFTP client: %v", err)
	}
	defer sftpClient.Close()

	// Initialize database client
	databaseURL := requireEnv("DATABASE_URL")
	dbClient, err := db.NewClient(databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer dbClient.Close()
	log.Println("Connected to database")

	// Initialize auth middleware
	supabaseURL := requireEnv("SUPABASE_URL")
	jwtSecret := os.Getenv("SUPABASE_JWT_SECRET") // Optional for local dev (HS256 fallback)
	authMiddleware, err := authmw.NewAuthMiddleware(supabaseURL, jwtSecret)
	if err != nil {
		log.Fatalf("Failed to initialize auth middleware: %v", err)
	}
	log.Println("Auth middleware initialized with JWKS")

	// Initialize encryption service (optional - if key not set, API keys feature is disabled)
	var encryptor *crypto.Encryptor
	var apiKeysHandler *handlers.APIKeysHandler
	if os.Getenv("ENCRYPTION_MASTER_KEY") != "" {
		encryptor, err = crypto.NewEncryptor()
		if err != nil {
			log.Fatalf("Failed to initialize encryptor: %v", err)
		}
		apiKeysHandler = handlers.NewAPIKeysHandler(dbClient, encryptor)
		log.Println("Encryption service initialized")
	} else {
		log.Println("Warning: ENCRYPTION_MASTER_KEY not set, API keys feature disabled")
	}
	// Convert to interface safely (avoids Go's typed-nil interface gotcha)
	apiKeysGetter := asAPIKeysGetter(apiKeysHandler)

	idleTimeout := time.Duration(idleTimeoutMin) * time.Minute

	// Create workspace factory (returns local or Fly implementations based on LOCAL_MODE)
	wsFactory := workspace.NewFactory(flyClient, sshClient)

	// New project-based handlers
	projectHandler := handlers.NewProjectHandler(dbClient, wsFactory.MachineManager(), wsFactory.VolumeManager(), apiKeysGetter, baseImage, flyRegion, idleTimeout)
	terminalHandler := handlers.NewTerminalHandler(wsFactory.TerminalProvider(), wsFactory.ConnectionResolver(), dbClient, authMiddleware, sshClient)
	agentHandler := handlers.NewAgentHandler(sshClient, wsFactory.ConnectionResolver(), dbClient, authMiddleware, apiKeysGetter)
	healthHandler := handlers.NewHealthHandler(dbClient, getEnv("VERSION", "dev"))
	filesHandler := handlers.NewFilesHandler(sftpClient, wsFactory.ConnectionResolver(), dbClient)
	portsHandler := handlers.NewPortsHandler(sshClient, wsFactory.ConnectionResolver(), dbClient)

	// Start idle project checker
	projectHandler.StartIdleChecker(1 * time.Minute)

	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check routes
	r.Get("/health", healthHandler.Health)
	r.Get("/healthz", healthHandler.Liveness)
	r.Get("/ready", healthHandler.Readiness)

	// Protected project routes (require auth)
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware.Authenticate)

		r.Route("/projects", func(r chi.Router) {
			r.Get("/", projectHandler.List)
			r.Post("/", projectHandler.Create)
			r.Get("/{id}", projectHandler.Get)
			r.Patch("/{id}", projectHandler.Update)
			r.Delete("/{id}", projectHandler.Delete)
			r.Post("/{id}/start", projectHandler.Start)
			r.Post("/{id}/stop", projectHandler.Stop)

			// File operations
			r.Route("/{id}/files", func(r chi.Router) {
				r.Get("/", filesHandler.ListOrRead)
				r.Get("/tree", filesHandler.ListTree)
				r.Put("/", filesHandler.Write)
				r.Delete("/", filesHandler.Delete)
				r.Post("/mkdir", filesHandler.Mkdir)
				r.Post("/rename", filesHandler.Rename)
			})

			// Port operations
			r.Post("/{id}/ports/{port}/kill", portsHandler.KillPort)
		})

		// User API keys routes
		if apiKeysHandler != nil {
			r.Route("/user/api-keys", func(r chi.Router) {
				r.Get("/", apiKeysHandler.List)
				r.Post("/", apiKeysHandler.Add)
				r.Delete("/{provider}", apiKeysHandler.Remove)
			})
		}

		// User settings routes
		userSettingsHandler := handlers.NewUserSettingsHandler(dbClient)
		r.Route("/user/settings", func(r chi.Router) {
			r.Get("/", userSettingsHandler.Get)
			r.Put("/", userSettingsHandler.Update)
		})
	})

	// Terminal endpoint handles its own auth (WebSocket subprotocol)
	r.Get("/projects/{id}/terminal", terminalHandler.HandleTerminal)

	// Agent endpoint handles its own auth (WebSocket subprotocol)
	r.Get("/projects/{id}/agent/{agent}", agentHandler.HandleAgent)

	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir("../frontend"))))

	log.Printf("Server starting on port %s", port)
	log.Printf("Fly App: %s, Region: %s", flyAppName, flyRegion)
	log.Printf("Base Image: %s", baseImage)
	log.Printf("Idle Timeout: %d minutes", idleTimeoutMin)

	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func loadSSHClient() (*ssh.Client, error) {
	if keyPath := os.Getenv("SSH_PRIVATE_KEY_PATH"); keyPath != "" {
		return ssh.NewClient(keyPath, "coder")
	}

	if keyBase64 := os.Getenv("SSH_PRIVATE_KEY"); keyBase64 != "" {
		keyBytes, err := base64.StdEncoding.DecodeString(keyBase64)
		if err != nil {
			return nil, err
		}
		return ssh.NewClientFromKey(keyBytes, "coder")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return ssh.NewClient(homeDir+"/.ssh/id_rsa", "coder")
}

func loadSFTPClient() (*sftp.Client, error) {
	if keyPath := os.Getenv("SSH_PRIVATE_KEY_PATH"); keyPath != "" {
		return sftp.NewClient(keyPath, "coder")
	}

	if keyBase64 := os.Getenv("SSH_PRIVATE_KEY"); keyBase64 != "" {
		keyBytes, err := base64.StdEncoding.DecodeString(keyBase64)
		if err != nil {
			return nil, err
		}
		return sftp.NewClientFromKey(keyBytes, "coder")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return sftp.NewClient(homeDir+"/.ssh/id_rsa", "coder")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("Required environment variable %s is not set", key)
	}
	return value
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if result, err := strconv.Atoi(value); err == nil {
			return result
		}
	}
	return defaultValue
}

// asAPIKeysGetter safely converts *APIKeysHandler to APIKeysGetter interface.
// This avoids Go's typed-nil interface gotcha where a nil concrete pointer
// assigned to an interface makes the interface non-nil.
func asAPIKeysGetter(h *handlers.APIKeysHandler) handlers.APIKeysGetter {
	if h == nil {
		return nil
	}
	return h
}
