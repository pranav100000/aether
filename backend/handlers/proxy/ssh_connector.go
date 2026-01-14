package proxy

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	"aether/ssh"
)

// SSHConnector implements ProxyConnector using SSH stdin/stdout
type SSHConnector struct {
	sshClient *ssh.Client
	session   *ssh.Session
	msgChan   chan []byte
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
}

// NewSSHConnector creates a new SSH-based connector
func NewSSHConnector(sshClient *ssh.Client) *SSHConnector {
	return &SSHConnector{
		sshClient: sshClient,
		msgChan:   make(chan []byte, 100),
		done:      make(chan struct{}),
	}
}

// Connect establishes SSH connection and starts the agent CLI
func (c *SSHConnector) Connect(ctx context.Context, config ConnectorConfig) error {
	timeout := config.ConnectTimeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	// Connect with retry
	session, err := c.sshClient.ConnectWithRetry(config.Host, config.Port, 5, 2*time.Second)
	if err != nil {
		return fmt.Errorf("SSH connection failed: %w", err)
	}
	c.session = session

	// Build environment file content and encode
	envContent := toEnvFileContent(config.Environment)
	encodedEnv := base64.StdEncoding.EncodeToString([]byte(envContent))

	// Start the agent CLI
	// Write env vars via base64 (avoids shell escaping issues), then source and run
	// Use "." instead of "source" for POSIX shell compatibility
	// cd to project directory so agent runs in correct context
	cmd := fmt.Sprintf(
		"echo %s | base64 -d > ~/.aether_env && . ~/.aether_env && cd /home/coder/project && exec /usr/local/bin/bun /opt/workspace-service/src/cli.ts %s",
		encodedEnv,
		config.AgentType,
	)

	log.Printf("Starting agent via SSH for type: %s", config.AgentType)
	if err := session.Start(cmd); err != nil {
		session.Close()
		return fmt.Errorf("failed to start agent: %w", err)
	}

	// Start goroutines for reading
	go c.readStdout()
	go c.readStderr()
	go c.keepAlive()

	return nil
}

// Send transmits raw JSON bytes to the agent via stdin
func (c *SSHConnector) Send(ctx context.Context, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.session == nil {
		return fmt.Errorf("not connected")
	}

	// Append newline for JSON lines protocol
	data = append(data, '\n')
	_, err := c.session.Write(data)
	return err
}

// Receive returns the channel of raw JSON messages from the agent
func (c *SSHConnector) Receive() <-chan []byte {
	return c.msgChan
}

// Close terminates the SSH connection
func (c *SSHConnector) Close() error {
	c.closeOnce.Do(func() {
		close(c.done)
	})

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.session != nil {
		return c.session.Close()
	}
	return nil
}

// Done signals when the connection terminates
func (c *SSHConnector) Done() <-chan struct{} {
	return c.done
}

// readStdout reads from SSH stdout and sends raw JSON lines to msgChan
func (c *SSHConnector) readStdout() {
	buf := make([]byte, 4096)
	var buffer strings.Builder

	for {
		select {
		case <-c.done:
			return
		default:
		}

		n, err := c.session.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("SSH stdout read error: %v", err)
			}
			c.closeDone()
			return
		}

		if n > 0 {
			buffer.Write(buf[:n])

			// Process complete JSON lines
			content := buffer.String()
			lines := strings.Split(content, "\n")

			// Keep the last incomplete line in the buffer
			buffer.Reset()
			if len(lines) > 0 && !strings.HasSuffix(content, "\n") {
				buffer.WriteString(lines[len(lines)-1])
				lines = lines[:len(lines)-1]
			}

			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}

				// Send raw JSON bytes (no parsing here - transport agnostic)
				select {
				case c.msgChan <- []byte(line):
				case <-c.done:
					return
				}
			}
		}
	}
}

// readStderr reads from SSH stderr and logs/sends errors
func (c *SSHConnector) readStderr() {
	buf := make([]byte, 4096)
	stderr := c.session.Stderr()

	for {
		select {
		case <-c.done:
			return
		default:
		}

		n, err := stderr.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("SSH stderr read error: %v", err)
			}
			return
		}

		if n > 0 {
			content := strings.TrimSpace(string(buf[:n]))
			if content != "" {
				log.Printf("Agent stderr: %s", content)
				// Send stderr as an error message (JSON formatted)
				errMsg := fmt.Sprintf(`{"type":"error","error":%q}`, content)
				select {
				case c.msgChan <- []byte(errMsg):
				case <-c.done:
					return
				}
			}
		}
	}
}

// keepAlive sends periodic keepalive requests over the SSH connection
func (c *SSHConnector) keepAlive() {
	c.session.KeepAlive(30*time.Second, c.done)
}

// closeDone closes the done channel and msgChan once
func (c *SSHConnector) closeDone() {
	c.closeOnce.Do(func() {
		close(c.done)
		close(c.msgChan)
	})
}

// toEnvFileContent converts environment map to shell export format
func toEnvFileContent(env map[string]string) string {
	var lines []string
	for key, value := range env {
		// Escape single quotes in value
		escaped := strings.ReplaceAll(value, "'", "'\\''")
		lines = append(lines, fmt.Sprintf("export %s='%s'", key, escaped))
	}
	return strings.Join(lines, "\n")
}
