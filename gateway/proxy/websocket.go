package proxy

import (
	"fmt"
	"io"
	"log"
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
		log.Printf("Failed to connect to WebSocket target %s: %v", targetAddr, err)
		http.Error(w, "Failed to connect to project", http.StatusBadGateway)
		return
	}
	defer targetConn.Close()

	// Hijack the client connection
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		log.Printf("ResponseWriter does not support hijacking")
		http.Error(w, "WebSocket not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		log.Printf("Failed to hijack connection: %v", err)
		http.Error(w, "Failed to upgrade connection", http.StatusInternalServerError)
		return
	}
	defer clientConn.Close()

	// Modify Host header to localhost so dev servers don't block the request
	r.Host = fmt.Sprintf("localhost:%d", port)

	// Forward the upgrade request to the target
	err = r.Write(targetConn)
	if err != nil {
		log.Printf("Failed to write upgrade request to target: %v", err)
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
		log.Printf("WebSocket proxy error: %v", err)
	}
}

// copyWithDeadline copies data with periodic deadline updates
// This helps keep long-lived WebSocket connections alive
func copyWithDeadline(dst, src net.Conn, deadline time.Duration) error {
	buf := make([]byte, 32*1024)
	for {
		// Set read deadline
		src.SetReadDeadline(time.Now().Add(deadline))

		n, err := src.Read(buf)
		if n > 0 {
			// Reset write deadline
			dst.SetWriteDeadline(time.Now().Add(deadline))

			_, writeErr := dst.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
		}
		if err != nil {
			return err
		}
	}
}
