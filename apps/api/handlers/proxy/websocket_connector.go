package proxy

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocketConnector implements ProxyConnector using WebSocket
type WebSocketConnector struct {
	conn      *websocket.Conn
	msgChan   chan []byte
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
}

// NewWebSocketConnector creates a new WebSocket-based connector
func NewWebSocketConnector() *WebSocketConnector {
	return &WebSocketConnector{
		msgChan: make(chan []byte, 100),
		done:    make(chan struct{}),
	}
}

// Connect establishes WebSocket connection to the VM's agent service
func (c *WebSocketConnector) Connect(ctx context.Context, config ConnectorConfig) error {
	timeout := config.ConnectTimeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	// Build WebSocket URL
	endpoint := config.Endpoint
	if endpoint == "" {
		// Legacy fallback: use agent-specific endpoint
		endpoint = fmt.Sprintf("/agent/%s", config.AgentType)
	}

	wsURL := fmt.Sprintf("ws://%s%s", net.JoinHostPort(config.Host, fmt.Sprintf("%d", config.Port)), endpoint)

	// Pass environment variables via headers (base64 encoded)
	headers := make(http.Header)
	for key, value := range config.Environment {
		headers.Set("X-Agent-Env-"+key, base64.StdEncoding.EncodeToString([]byte(value)))
	}

	// Create dialer with timeout
	dialer := websocket.Dialer{
		HandshakeTimeout: timeout,
	}

	log.Printf("Connecting to WebSocket: %s", wsURL)

	// Connect with retry
	var conn *websocket.Conn
	var err error
	maxRetries := 5
	retryDelay := 2 * time.Second

	for i := 0; i < maxRetries; i++ {
		conn, _, err = dialer.DialContext(ctx, wsURL, headers)
		if err == nil {
			break
		}
		log.Printf("WebSocket connection attempt %d failed: %v", i+1, err)
		if i < maxRetries-1 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(retryDelay):
			}
		}
	}

	if err != nil {
		return fmt.Errorf("WebSocket connection failed after %d retries: %w", maxRetries, err)
	}

	c.conn = conn
	log.Printf("WebSocket connected: %s", wsURL)

	// Start read loop
	go c.readLoop()

	return nil
}

// Send transmits raw JSON bytes to the agent via WebSocket
func (c *WebSocketConnector) Send(ctx context.Context, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// Receive returns the channel of raw JSON messages from the agent
func (c *WebSocketConnector) Receive() <-chan []byte {
	return c.msgChan
}

// Close terminates the WebSocket connection
func (c *WebSocketConnector) Close() error {
	c.closeOnce.Do(func() {
		close(c.done)
	})

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// Done signals when the connection terminates
func (c *WebSocketConnector) Done() <-chan struct{} {
	return c.done
}

// readLoop reads messages from WebSocket and sends to msgChan
func (c *WebSocketConnector) readLoop() {
	defer c.closeDone()

	for {
		select {
		case <-c.done:
			return
		default:
		}

		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		// Send raw bytes to channel (transport agnostic - no parsing)
		select {
		case c.msgChan <- data:
		case <-c.done:
			return
		}
	}
}

// closeDone closes the done channel and msgChan once
func (c *WebSocketConnector) closeDone() {
	c.closeOnce.Do(func() {
		close(c.done)
		close(c.msgChan)
	})
}
