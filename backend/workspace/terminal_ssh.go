package workspace

import (
	"time"

	"aether/handlers"
	"aether/ssh"
)

// SSHTerminalProvider implements handlers.TerminalProvider using SSH
type SSHTerminalProvider struct {
	client *ssh.Client
}

func NewSSHTerminalProvider(client *ssh.Client) *SSHTerminalProvider {
	return &SSHTerminalProvider{client: client}
}

func (p *SSHTerminalProvider) CreateSession(host string, port int) (handlers.TerminalSession, error) {
	session, err := p.client.Connect(host, port)
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (p *SSHTerminalProvider) CreateSessionWithRetry(host string, port int, maxRetries int, retryDelay time.Duration) (handlers.TerminalSession, error) {
	session, err := p.client.ConnectWithRetry(host, port, maxRetries, retryDelay)
	if err != nil {
		return nil, err
	}
	return session, nil
}

// ssh.Session already implements handlers.TerminalSession interface
