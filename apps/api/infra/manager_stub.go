package infra

import (
	"context"
	"errors"
	"time"

	"aether/apps/api/handlers"
)

var ErrNotImplemented = errors.New("infra manager not implemented")

// StubManager is a placeholder InfraServiceManager that returns errors.
// It will be replaced with real implementations (Fly.io, local Docker) in Phase 5.
type StubManager struct{}

func NewStubManager() *StubManager {
	return &StubManager{}
}

func (m *StubManager) Provision(ctx context.Context, projectID string, serviceType string, name string, config map[string]interface{}) (*handlers.InfraService, error) {
	return nil, ErrNotImplemented
}

func (m *StubManager) Get(ctx context.Context, serviceID string) (*handlers.InfraService, error) {
	return nil, ErrNotImplemented
}

func (m *StubManager) List(ctx context.Context, projectID string) ([]*handlers.InfraService, error) {
	return nil, ErrNotImplemented
}

func (m *StubManager) Delete(ctx context.Context, serviceID string) error {
	return ErrNotImplemented
}

func (m *StubManager) Stop(ctx context.Context, serviceID string) error {
	return ErrNotImplemented
}

func (m *StubManager) Start(ctx context.Context, serviceID string) error {
	return ErrNotImplemented
}

func (m *StubManager) WaitForReady(ctx context.Context, serviceID string, timeout time.Duration) error {
	return ErrNotImplemented
}
