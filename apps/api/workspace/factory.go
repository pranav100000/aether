package workspace

import (
	"aether/apps/api/config"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	"aether/apps/api/local"
	"aether/apps/api/ssh"
)

// Factory creates workspace-related managers based on the runtime mode
type Factory struct {
	flyClient *fly.Client
	sshClient *ssh.Client
}

func NewFactory(flyClient *fly.Client, sshClient *ssh.Client) *Factory {
	return &Factory{
		flyClient: flyClient,
		sshClient: sshClient,
	}
}

// MachineManager returns the appropriate MachineManager implementation
func (f *Factory) MachineManager() handlers.MachineManager {
	if config.IsLocalMode() {
		return local.NewMachineManager()
	}
	return f.flyClient
}

// VolumeManager returns the appropriate VolumeManager implementation
func (f *Factory) VolumeManager() handlers.VolumeManager {
	if config.IsLocalMode() {
		return local.NewVolumeManager()
	}
	return f.flyClient
}

// TerminalProvider returns the appropriate TerminalProvider implementation
// Both local (Docker) and production (Fly) use SSH, so we always return SSH provider
func (f *Factory) TerminalProvider() handlers.TerminalProvider {
	return NewSSHTerminalProvider(f.sshClient)
}

// ConnectionResolver returns the appropriate ConnectionResolver implementation
func (f *Factory) ConnectionResolver() handlers.ConnectionResolver {
	if config.IsLocalMode() {
		return NewLocalConnectionResolver()
	}
	return NewFlyConnectionResolver(f.flyClient)
}
