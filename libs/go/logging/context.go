package logging

import (
	"context"
)

type contextKey string

const (
	RequestIDKey contextKey = "request_id"
	UserIDKey    contextKey = "user_id"
	ProjectIDKey contextKey = "project_id"
	LoggerKey    contextKey = "logger"
)

// WithRequestID adds request ID to context
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, RequestIDKey, requestID)
}

// WithUserID adds user ID to context
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, UserIDKey, userID)
}

// WithProjectID adds project ID to context
func WithProjectID(ctx context.Context, projectID string) context.Context {
	return context.WithValue(ctx, ProjectIDKey, projectID)
}

// WithLogger adds a logger to context
func WithLogger(ctx context.Context, logger *Logger) context.Context {
	return context.WithValue(ctx, LoggerKey, logger)
}

// FromContext extracts the logger from context, enriched with context values.
// Falls back to default logger if none in context.
func FromContext(ctx context.Context) *Logger {
	logger, ok := ctx.Value(LoggerKey).(*Logger)
	if !ok || logger == nil {
		logger = Default()
	}

	// Enrich with context values
	var attrs []any
	if reqID, ok := ctx.Value(RequestIDKey).(string); ok && reqID != "" {
		attrs = append(attrs, "request_id", reqID)
	}
	if userID, ok := ctx.Value(UserIDKey).(string); ok && userID != "" {
		attrs = append(attrs, "user_id", userID)
	}
	if projectID, ok := ctx.Value(ProjectIDKey).(string); ok && projectID != "" {
		attrs = append(attrs, "project_id", projectID)
	}

	if len(attrs) > 0 {
		return logger.With(attrs...)
	}
	return logger
}

// GetRequestID extracts request ID from context
func GetRequestID(ctx context.Context) string {
	if v, ok := ctx.Value(RequestIDKey).(string); ok {
		return v
	}
	return ""
}

// GetUserID extracts user ID from context
func GetUserID(ctx context.Context) string {
	if v, ok := ctx.Value(UserIDKey).(string); ok {
		return v
	}
	return ""
}

// GetProjectID extracts project ID from context
func GetProjectID(ctx context.Context) string {
	if v, ok := ctx.Value(ProjectIDKey).(string); ok {
		return v
	}
	return ""
}
