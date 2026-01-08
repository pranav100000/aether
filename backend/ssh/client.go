package ssh

import (
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type Client struct {
	privateKey ssh.Signer
	user       string
}

type Session struct {
	conn    *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  io.Reader
	mu      sync.Mutex
}

func NewClient(privateKeyPath string, user string) (*Client, error) {
	keyBytes, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	return &Client{
		privateKey: signer,
		user:       user,
	}, nil
}

func NewClientFromKey(privateKey []byte, user string) (*Client, error) {
	signer, err := ssh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	return &Client{
		privateKey: signer,
		user:       user,
	}, nil
}

func (c *Client) Connect(host string, port int) (*Session, error) {
	config := &ssh.ClientConfig{
		User: c.user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(c.privateKey),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	conn, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("failed to dial: %w", err)
	}

	session, err := conn.NewSession()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	return &Session{
		conn:    conn,
		session: session,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
	}, nil
}

func (c *Client) ConnectWithRetry(host string, port int, maxRetries int, retryDelay time.Duration) (*Session, error) {
	var lastErr error

	for i := 0; i < maxRetries; i++ {
		session, err := c.Connect(host, port)
		if err == nil {
			return session, nil
		}

		lastErr = err

		if i < maxRetries-1 {
			time.Sleep(retryDelay)
		}
	}

	return nil, fmt.Errorf("failed to connect after %d retries: %w", maxRetries, lastErr)
}

func (s *Session) RequestPTY(term string, cols, rows int) error {
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	return s.session.RequestPty(term, rows, cols, modes)
}

func (s *Session) StartShell() error {
	return s.session.Shell()
}

func (s *Session) Resize(cols, rows int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.session.WindowChange(rows, cols)
}

func (s *Session) Write(data []byte) (int, error) {
	return s.stdin.Write(data)
}

func (s *Session) Read(buf []byte) (int, error) {
	return s.stdout.Read(buf)
}

func (s *Session) Stderr() io.Reader {
	return s.stderr
}

func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var errs []error

	if s.stdin != nil {
		if err := s.stdin.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if s.session != nil {
		if err := s.session.Close(); err != nil && err != io.EOF {
			errs = append(errs, err)
		}
	}

	if s.conn != nil {
		if err := s.conn.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing session: %v", errs)
	}

	return nil
}

func (s *Session) Wait() error {
	return s.session.Wait()
}

func (s *Session) KeepAlive(interval time.Duration, done <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			_, _, err := s.conn.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func IsConnectionError(err error) bool {
	if err == nil {
		return false
	}

	if _, ok := err.(*net.OpError); ok {
		return true
	}

	if err == io.EOF {
		return true
	}

	return false
}
