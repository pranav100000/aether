package main

import (
	"encoding/base64"
	"net/http"
	"os"
	"strconv"
	"time"

	"aether/apps/api/config"
	"aether/apps/api/crypto"
	"aether/apps/api/db"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	authmw "aether/apps/api/middleware"
	"aether/libs/go/logging"
	"aether/apps/api/sftp"
	"aether/apps/api/ssh"
	"aether/apps/api/workspace"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	sentryhttp "github.com/getsentry/sentry-go/http"
)

func main() {
	// Initialize Sentry first (if DSN is configured)
	sentryCleanup, err := logging.InitSentry(logging.SentryConfig{
		DSN:              os.Getenv("SENTRY_DSN"),
		Environment:      os.Getenv("ENVIRONMENT"),
		TracesSampleRate: 0.1,
	})
	if err != nil {
		// Can't use logger yet, fall back to stderr
		os.Stderr.WriteString("failed to initialize Sentry: " + err.Error() + "\n")
		os.Exit(1)
	}
	defer sentryCleanup()

	// Initialize logger (will now capture errors to Sentry)
	logger := logging.Init()

	// Load .env file if it exists (check both current dir and parent)
	if err := godotenv.Load(); err != nil {
		if err := godotenv.Load("../.env"); err != nil {
			logger.Debug("no .env file found, using environment variables")
		}
	}
	port := getEnv("API_PORT", "8080")

	// Initialize config (checks LOCAL_MODE env var)
	cfg := config.Get()

	// Fly.io config (not required in local mode)
	var flyToken, flyAppName, flyRegion, baseImage string
	if !cfg.LocalMode {
		flyToken = requireEnv(logger, "FLY_API_TOKEN")
		flyAppName = requireEnv(logger, "FLY_VMS_APP_NAME")
		flyRegion = getEnv("FLY_REGION", "sjc")
		baseImage = getEnv("BASE_IMAGE", "registry.fly.io/"+flyAppName+"/base:latest")
	} else {
		flyToken = os.Getenv("FLY_API_TOKEN")
		flyAppName = os.Getenv("FLY_VMS_APP_NAME")
		flyRegion = getEnv("FLY_REGION", "sjc")
		baseImage = getEnv("BASE_IMAGE", "")
		logger.Info("LOCAL_MODE enabled - Fly.io VM operations will be skipped")
		logger.Info("local project directory configured", "path", cfg.LocalProjectDir)
	}
	idleTimeoutMin := getEnvInt("IDLE_TIMEOUT_MINUTES", 10)

	flyClient := fly.NewClient(flyToken, flyAppName, flyRegion)

	sshClient, err := loadSSHClient()
	if err != nil {
		logger.Error("failed to load SSH client", "error", err)
		os.Exit(1)
	}

	// Initialize SFTP client (uses same SSH key)
	sftpClient, err := loadSFTPClient()
	if err != nil {
		logger.Error("failed to load SFTP client", "error", err)
		os.Exit(1)
	}
	defer sftpClient.Close()

	// Initialize database client
	databaseURL := requireEnv(logger, "DATABASE_URL")
	dbClient, err := db.NewClient(databaseURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer dbClient.Close()
	logger.Info("connected to database")

	// Initialize auth middleware
	supabaseURL := requireEnv(logger, "SUPABASE_URL")
	jwtSecret := os.Getenv("SUPABASE_JWT_SECRET") // Optional for local dev (HS256 fallback)
	authMiddleware, err := authmw.NewAuthMiddleware(supabaseURL, jwtSecret)
	if err != nil {
		logger.Error("failed to initialize auth middleware", "error", err)
		os.Exit(1)
	}
	logger.Info("auth middleware initialized with JWKS")

	// Initialize encryption service (optional - if key not set, API keys feature is disabled)
	var encryptor *crypto.Encryptor
	var apiKeysHandler *handlers.APIKeysHandler
	if os.Getenv("ENCRYPTION_MASTER_KEY") != "" {
		encryptor, err = crypto.NewEncryptor()
		if err != nil {
			logger.Error("failed to initialize encryptor", "error", err)
			os.Exit(1)
		}
		apiKeysHandler = handlers.NewAPIKeysHandler(dbClient, encryptor)
		logger.Info("encryption service initialized")
	} else {
		logger.Warn("ENCRYPTION_MASTER_KEY not set, API keys feature disabled")
	}
	// Convert to interface safely (avoids Go's typed-nil interface gotcha)
	apiKeysGetter := asAPIKeysGetter(apiKeysHandler)

	idleTimeout := time.Duration(idleTimeoutMin) * time.Minute

	// Create workspace factory (returns local or Fly implementations based on LOCAL_MODE)
	wsFactory := workspace.NewFactory(flyClient)

	// New project-based handlers
	projectHandler := handlers.NewProjectHandler(dbClient, wsFactory.MachineManager(), wsFactory.VolumeManager(), apiKeysGetter, baseImage, flyRegion, idleTimeout)
	agentHandler := handlers.NewAgentHandler(wsFactory.ConnectionResolver(), dbClient, authMiddleware, apiKeysGetter)
	workspaceHandler := handlers.NewWorkspaceHandler(wsFactory.ConnectionResolver(), dbClient, authMiddleware, apiKeysGetter)
	healthHandler := handlers.NewHealthHandler(dbClient, getEnv("VERSION", "dev"))
	filesHandler := handlers.NewFilesHandler(sftpClient, wsFactory.ConnectionResolver(), dbClient)
	portsHandler := handlers.NewPortsHandler(sshClient, wsFactory.ConnectionResolver(), dbClient)

	// Start idle project checker
	projectHandler.StartIdleChecker(1 * time.Minute)

	r := chi.NewRouter()

	// Create Sentry HTTP handler for panic recovery and request context
	sentryHandler := sentryhttp.New(sentryhttp.Options{
		Repanic: true, // Re-panic after capturing so chi's Recoverer can log it
	})

	// Middleware order matters:
	// 1. RequestID - generates request ID first
	// 2. RealIP - extracts client IP
	// 3. Sentry - attaches hub to context, captures panics
	// 4. RequestLogger - logs requests and enriches context with request_id
	// 5. Recoverer - catches panics (after Sentry captures them)
	// 6. Timeout - limits request duration
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(func(next http.Handler) http.Handler {
		return sentryHandler.Handle(next)
	})
	r.Use(logging.RequestLogger(logger))
	r.Use(middleware.Recoverer)
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

	// Agent endpoint handles its own auth (WebSocket subprotocol - legacy)
	r.Get("/projects/{id}/agent/{agent}", agentHandler.HandleAgent)

	// Unified workspace endpoint (terminal + agent + files + ports over single WebSocket)
	r.Get("/projects/{id}/workspace", workspaceHandler.HandleWorkspace)

	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir("../frontend"))))

	logger.Info("server starting",
		"port", port,
		"fly_app", flyAppName,
		"fly_region", flyRegion,
		"base_image", baseImage,
		"idle_timeout_minutes", idleTimeoutMin,
	)

	if err := http.ListenAndServe(":"+port, r); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
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

func requireEnv(logger *logging.Logger, key string) string {
	value := os.Getenv(key)
	if value == "" {
		logger.Error("required environment variable not set", "key", key)
		os.Exit(1)
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
