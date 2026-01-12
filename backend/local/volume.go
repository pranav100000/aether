package local

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"aether/config"
	"aether/handlers"
)

// VolumeManager implements handlers.VolumeManager for local development.
// It creates local directories instead of Fly.io volumes.
type VolumeManager struct {
	mu      sync.RWMutex
	volumes map[string]*handlers.Volume
}

func NewVolumeManager() *VolumeManager {
	return &VolumeManager{
		volumes: make(map[string]*handlers.Volume),
	}
}

func (v *VolumeManager) CreateVolume(name string, sizeGB int, region string) (*handlers.Volume, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	id := "local-vol-" + name

	// Create local directory for the volume
	localDir := filepath.Join(config.GetLocalProjectDir(), name)
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return nil, err
	}

	volume := &handlers.Volume{
		ID:        id,
		Name:      name,
		SizeGB:    sizeGB,
		Region:    "local",
		State:     "created",
		CreatedAt: time.Now().Format(time.RFC3339),
	}
	v.volumes[id] = volume
	return volume, nil
}

func (v *VolumeManager) GetVolume(volumeID string) (*handlers.Volume, error) {
	v.mu.RLock()
	defer v.mu.RUnlock()

	volume, ok := v.volumes[volumeID]
	if !ok {
		return nil, fmt.Errorf("volume %s not found in local manager", volumeID)
	}
	return volume, nil
}

func (v *VolumeManager) DeleteVolume(volumeID string) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	delete(v.volumes, volumeID)
	// Note: We don't delete the local directory to preserve data
	return nil
}
