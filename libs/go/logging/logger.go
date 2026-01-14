package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
)

// Logger wraps slog.Logger to provide a stable API that doesn't leak implementation details.
// This allows us to:
// 1. Swap logging backends without changing consumer code
// 2. Add hooks (e.g., Sentry) in one place
// 3. Control the API surface
type Logger struct {
	slog *slog.Logger
}

// Config holds logger configuration
type Config struct {
	Level     string    // "debug", "info", "warn", "error"
	Format    string    // "json", "text"
	AddSource bool      // Include source file/line in logs
	Output    io.Writer // Output destination (default: os.Stdout)
}

var defaultLogger *Logger
var sentryEnabled bool

// SentryConfig holds Sentry configuration
type SentryConfig struct {
	DSN              string
	Environment      string
	TracesSampleRate float64
}

// InitSentry initializes Sentry for error reporting.
// Call this before Init() in main.go if you want Sentry integration.
// Returns a cleanup function that should be deferred.
func InitSentry(cfg SentryConfig) (func(), error) {
	if cfg.DSN == "" {
		return func() {}, nil
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:              cfg.DSN,
		Environment:      cfg.Environment,
		TracesSampleRate: cfg.TracesSampleRate,
		EnableLogs:       true,
	})
	if err != nil {
		return nil, err
	}

	sentryEnabled = true

	cleanup := func() {
		sentry.Flush(2 * time.Second)
	}

	return cleanup, nil
}

// Init initializes the global logger from environment variables.
// LOG_LEVEL: debug, info, warn, error (default: info)
// LOG_FORMAT: json, text (default: json, or text if LOCAL_MODE=true)
func Init() *Logger {
	cfg := Config{
		Level:     getEnv("LOG_LEVEL", "info"),
		Format:    getEnv("LOG_FORMAT", ""),
		AddSource: getEnv("LOG_ADD_SOURCE", "false") == "true",
		Output:    os.Stdout,
	}

	// Auto-detect format based on LOCAL_MODE if not explicitly set
	if cfg.Format == "" {
		if os.Getenv("LOCAL_MODE") == "true" {
			cfg.Format = "text"
		} else {
			cfg.Format = "json"
		}
	}

	defaultLogger = New(cfg)
	return defaultLogger
}

// New creates a new logger with the given configuration
func New(cfg Config) *Logger {
	level := parseLevel(cfg.Level)

	output := cfg.Output
	if output == nil {
		output = os.Stdout
	}

	opts := &slog.HandlerOptions{
		Level:     level,
		AddSource: cfg.AddSource,
	}

	var handler slog.Handler
	if cfg.Format == "text" {
		handler = slog.NewTextHandler(output, opts)
	} else {
		handler = slog.NewJSONHandler(output, opts)
	}

	return &Logger{slog: slog.New(handler)}
}

// Default returns the default logger, initializing it if necessary
func Default() *Logger {
	if defaultLogger == nil {
		return Init()
	}
	return defaultLogger
}

// With returns a new Logger with the given key-value pairs added to every log entry
func (l *Logger) With(args ...any) *Logger {
	return &Logger{slog: l.slog.With(args...)}
}

// Debug logs at debug level
func (l *Logger) Debug(msg string, args ...any) {
	l.slog.Debug(msg, args...)
}

// Info logs at info level and sends to Sentry Logs if enabled
func (l *Logger) Info(msg string, args ...any) {
	l.slog.Info(msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(context.Background()).Info(), msg, args)
	}
}

// Warn logs at warn level and sends to Sentry Logs if enabled
func (l *Logger) Warn(msg string, args ...any) {
	l.slog.Warn(msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(context.Background()).Warn(), msg, args)
	}
}

// Error logs at error level and sends to Sentry Logs if enabled
func (l *Logger) Error(msg string, args ...any) {
	l.slog.Error(msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(context.Background()).Error(), msg, args)
	}
}

// DebugContext logs at debug level with context
func (l *Logger) DebugContext(ctx context.Context, msg string, args ...any) {
	l.slog.DebugContext(ctx, msg, args...)
}

// InfoContext logs at info level with context and sends to Sentry Logs if enabled
func (l *Logger) InfoContext(ctx context.Context, msg string, args ...any) {
	l.slog.InfoContext(ctx, msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(ctx).Info(), msg, args)
	}
}

// WarnContext logs at warn level with context and sends to Sentry Logs if enabled
func (l *Logger) WarnContext(ctx context.Context, msg string, args ...any) {
	l.slog.WarnContext(ctx, msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(ctx).Warn(), msg, args)
	}
}

// ErrorContext logs at error level with context and sends to Sentry Logs if enabled
func (l *Logger) ErrorContext(ctx context.Context, msg string, args ...any) {
	l.slog.ErrorContext(ctx, msg, args...)
	if sentryEnabled {
		logToSentry(sentry.NewLogger(ctx).Error(), msg, args)
	}
}

// logToSentry sends a log entry to Sentry Logs with key-value attributes
func logToSentry(entry sentry.LogEntry, msg string, args []any) {
	for i := 0; i+1 < len(args); i += 2 {
		if key, ok := args[i].(string); ok {
			entry = entry.String(key, formatValue(args[i+1]))
		}
	}
	entry.Emit(msg)
}

// formatValue converts any value to a string for Sentry attributes
func formatValue(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case error:
		return val.Error()
	default:
		return fmt.Sprintf("%v", val)
	}
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
