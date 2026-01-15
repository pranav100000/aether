package proxy

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// proxyWebSocket handles WebSocket upgrade requests
// This is critical for HMR (Hot Module Replacement) in Vite, webpack, etc.
func (h *Handler) proxyWebSocket(w http.ResponseWriter, r *http.Request, privateIP string, port int) {
	// Get the target address (net.JoinHostPort handles IPv6 addresses correctly)
	targetAddr := net.JoinHostPort(privateIP, fmt.Sprintf("%d", port))

	// Connect to the target
	targetConn, err := net.DialTimeout("tcp", targetAddr, 10*time.Second)
	if err != nil {
		h.log.Error("failed to connect to WebSocket target", "target", targetAddr, "error", err)
		http.Error(w, "Failed to connect to project", http.StatusBadGateway)
		return
	}
	defer func() {
		_ = targetConn.Close()
	}()

	// Hijack the client connection
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		h.log.Error("ResponseWriter does not support hijacking")
		http.Error(w, "WebSocket not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		h.log.Error("failed to hijack connection", "error", err)
		http.Error(w, "Failed to upgrade connection", http.StatusInternalServerError)
		return
	}
	defer func() {
		_ = clientConn.Close()
	}()

	// Modify Host header to localhost so dev servers don't block the request
	r.Host = fmt.Sprintf("localhost:%d", port)

	// Forward the upgrade request to the target
	err = r.Write(targetConn)
	if err != nil {
		h.log.Error("failed to write upgrade request to target", "error", err)
		return
	}

	// Create error channel
	errCh := make(chan error, 2)

	// Copy data bidirectionally
	go func() {
		_, err := io.Copy(targetConn, clientConn)
		errCh <- err
	}()

	go func() {
		_, err := io.Copy(clientConn, targetConn)
		errCh <- err
	}()

	// Wait for either direction to close or error
	err = <-errCh
	if err != nil && err != io.EOF {
		h.log.Debug("websocket proxy closed", "error", err)
	}
}
