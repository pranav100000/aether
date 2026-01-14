package logging

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// RequestLogger returns a middleware that logs HTTP requests and enriches context.
// It captures the request ID from Chi's RequestID middleware and creates a
// request-scoped logger available via FromContext.
func RequestLogger(logger *Logger) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Get request ID from Chi's RequestID middleware
			reqID := middleware.GetReqID(r.Context())

			// Create request-scoped logger with initial attributes
			reqLogger := logger.With(
				"request_id", reqID,
				"method", r.Method,
				"path", r.URL.Path,
			)

			// Enrich context with request ID and logger
			ctx := r.Context()
			ctx = WithRequestID(ctx, reqID)
			ctx = WithLogger(ctx, reqLogger)

			// Wrap response writer to capture status code
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			// Log request start at debug level
			reqLogger.Debug("request started", "remote_addr", r.RemoteAddr)

			// Process request
			next.ServeHTTP(ww, r.WithContext(ctx))

			// Calculate duration
			duration := time.Since(start)
			status := ww.Status()

			// Log request completion with appropriate level based on status code
			attrs := []any{
				"status", status,
				"bytes", ww.BytesWritten(),
				"duration_ms", duration.Milliseconds(),
			}

			switch {
			case status >= 500:
				reqLogger.Error("request completed", attrs...)
			case status >= 400:
				reqLogger.Warn("request completed", attrs...)
			default:
				reqLogger.Info("request completed", attrs...)
			}
		})
	}
}
