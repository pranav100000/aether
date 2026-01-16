package workspace

import (
	"aether/apps/api/handlers"
)

// Factory provides workspace-related managers.
// All implementations are injected at construction time - no runtime branching.
type Factory struct {
	machines           handlers.MachineManager
	volumes            handlers.VolumeManager
	connectionResolver handlers.ConnectionResolver
	infraManager       handlers.InfraServiceManager
}

func NewFactory(
	machines handlers.MachineManager,
	volumes handlers.VolumeManager,
	connectionResolver handlers.ConnectionResolver,
	infraManager handlers.InfraServiceManager,
) *Factory {
	return &Factory{
		machines:           machines,
		volumes:            volumes,
		connectionResolver: connectionResolver,
		infraManager:       infraManager,
	}
}

// MachineManager returns the MachineManager implementation
func (f *Factory) MachineManager() handlers.MachineManager {
	return f.machines
}

// VolumeManager returns the VolumeManager implementation
func (f *Factory) VolumeManager() handlers.VolumeManager {
	return f.volumes
}

// ConnectionResolver returns the ConnectionResolver implementation
func (f *Factory) ConnectionResolver() handlers.ConnectionResolver {
	return f.connectionResolver
}

// InfraServiceManager returns the InfraServiceManager implementation
func (f *Factory) InfraServiceManager() handlers.InfraServiceManager {
	return f.infraManager
}
