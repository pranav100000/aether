package main

import (
	"net/http"
	"os"
	"strconv"
	"time"

	"aether/apps/api/config"
	"aether/apps/api/crypto"
	"aether/apps/api/db"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	"aether/apps/api/infra"
	"aether/apps/api/local"
	authmw "aether/apps/api/middleware"
	"aether/apps/api/workspace"
	"aether/libs/go/logging"

	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
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
		if _, writeErr := os.Stderr.WriteString("failed to initialize Sentry: " + err.Error() + "\n"); writeErr != nil {
			os.Exit(1)
		}
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

	// Validate configuration before proceeding
	if err := config.ValidateStartupConfig(logger); err != nil {
		logger.Error("startup validation failed", "error", err)
		sentryCleanup()
		os.Exit(1) //nolint:gocritic // sentryCleanup called explicitly above
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

	// Initialize infra registry
	infraRegistry := infra.NewRegistry()

	// Get the repo root directory for compose paths
	// In local mode, we need this to resolve relative compose paths
	// When running in a container (Docker-in-Docker), we need both container and host paths

	// Container repo root is always computed from working directory
	// Assumes we're running from apps/api, so go up two levels
	var containerRepoRoot string
	if wd, err := os.Getwd(); err == nil {
		containerRepoRoot = wd + "/../.."
	}

	// Host repo root is passed via REPO_ROOT when running in Docker (set in docker-compose.yml)
	// If not set, we assume we're running directly on the host, so container path = host path
	hostRepoRoot := os.Getenv("REPO_ROOT")
	if hostRepoRoot == "" {
		hostRepoRoot = containerRepoRoot
	}

	// Create implementations based on mode
	var machineManager handlers.MachineManager
	var volumeManager handlers.VolumeManager
	var connectionResolver handlers.ConnectionResolver
	var composeManager handlers.ComposeManager

	if cfg.LocalMode {
		machineManager = local.NewMachineManager()
		volumeManager = local.NewVolumeManager()
		connectionResolver = workspace.NewLocalConnectionResolver()
		composeManager = local.NewComposeManager(containerRepoRoot, hostRepoRoot)
	} else {
		machineManager = flyClient
		volumeManager = flyClient
		connectionResolver = workspace.NewFlyConnectionResolver(flyClient)
		// For Fly.io, we'll use compose compatibility (future implementation)
		// For now, use local compose manager as placeholder
		composeManager = local.NewComposeManager(containerRepoRoot, hostRepoRoot)
	}

	// Create infra manager with the appropriate implementations
	infraManager := infra.NewManager(machineManager, volumeManager, composeManager, infraRegistry, flyRegion, containerRepoRoot)

	// Create workspace factory with all implementations
	wsFactory := workspace.NewFactory(machineManager, volumeManager, connectionResolver, infraManager)
	infraRegistryAdapter := &serviceRegistryAdapter{registry: infraRegistry}
	infraHandler := handlers.NewInfraHandler(dbClient, dbClient, wsFactory.InfraServiceManager(), infraRegistryAdapter, encryptor)

	// New project-based handlers
	projectHandler := handlers.NewProjectHandler(dbClient, wsFactory.MachineManager(), wsFactory.VolumeManager(), apiKeysGetter, baseImage, flyRegion, idleTimeout)
	agentHandler := handlers.NewAgentHandler(wsFactory.ConnectionResolver(), dbClient, authMiddleware, apiKeysGetter)
	workspaceHandler := handlers.NewWorkspaceHandler(wsFactory.ConnectionResolver(), dbClient, authMiddleware, apiKeysGetter)
	healthHandler := handlers.NewHealthHandler(dbClient, getEnv("VERSION", "dev"))

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
			// File and port operations are now handled via WebSocket (workspace endpoint)

			// Infrastructure service routes
			r.Get("/{id}/infra", infraHandler.List)
			r.Post("/{id}/infra", infraHandler.Provision)
			r.Get("/{id}/infra/{serviceId}", infraHandler.Get)
			r.Delete("/{id}/infra/{serviceId}", infraHandler.Delete)
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

	// Internal routes (for workspace-service, no user auth required)
	r.Route("/internal", func(r chi.Router) {
		r.Get("/infra/types", infraHandler.ListServiceTypes)
		r.Get("/projects/{id}/infra", infraHandler.InternalList)
		r.Post("/projects/{id}/infra", infraHandler.InternalProvision)
	})

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

// serviceRegistryAdapter adapts infra.Registry to handlers.ServiceRegistry
type serviceRegistryAdapter struct {
	registry *infra.Registry
}

func (a *serviceRegistryAdapter) IsAvailable(serviceType string) bool {
	return a.registry.IsAvailable(serviceType)
}

func (a *serviceRegistryAdapter) List() []handlers.ServiceDefinition {
	infraDefs := a.registry.List()
	result := make([]handlers.ServiceDefinition, len(infraDefs))
	for i, def := range infraDefs {
		result[i] = handlers.ServiceDefinition{
			Type:        def.Type,
			DisplayName: def.DisplayName,
			Description: def.Description,
		}
	}
	return result
}
