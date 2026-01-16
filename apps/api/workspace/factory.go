package workspace

import (
	"aether/apps/api/config"
	"aether/apps/api/fly"
	"aether/apps/api/handlers"
	"aether/apps/api/infra"
	"aether/apps/api/local"
)

// Note: local is still used for MachineManager and VolumeManager in local mode

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

// InfraServiceManager returns the InfraServiceManager implementation
// Uses the same MachineManager/VolumeManager abstractions as workspace VMs
func (f *Factory) InfraServiceManager() handlers.InfraServiceManager {
	return infra.NewManager(
		f.MachineManager(),
		f.VolumeManager(),
		f.registry,
		f.flyClient.GetRegion(),
	)
}
