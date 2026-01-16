package workspace

import (
	"aether/apps/api/config"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	"aether/apps/api/infra"
	"aether/apps/api/local"
)

// Factory creates workspace-related managers based on the runtime mode
type Factory struct {
	flyClient *fly.Client
	registry  *infra.Registry
}

func NewFactory(flyClient *fly.Client, registry *infra.Registry) *Factory {
	return &Factory{
		flyClient: flyClient,
		registry:  registry,
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

// ConnectionResolver returns the appropriate ConnectionResolver implementation
func (f *Factory) ConnectionResolver() handlers.ConnectionResolver {
	if config.IsLocalMode() {
		return NewLocalConnectionResolver()
	}
	return NewFlyConnectionResolver(f.flyClient)
}

// InfraServiceManager returns the appropriate InfraServiceManager implementation
func (f *Factory) InfraServiceManager() handlers.InfraServiceManager {
	if config.IsLocalMode() {
		return local.NewInfraManager(f.registry)
	}
	return fly.NewInfraManager(f.flyClient, f.registry)
}
