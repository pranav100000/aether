.PHONY: help setup dev dev-services dev-frontend dev-backend stop clean logs check
.PHONY: supabase-start supabase-stop supabase-status supabase-reset db-shell

# Default target
help:
	@echo "Aether Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make setup          - Initial setup (install deps, generate keys)"
	@echo "  make check          - Check prerequisites"
	@echo ""
	@echo "Development (local):"
	@echo "  make dev            - Start everything (supabase + services + frontend)"
	@echo "  make dev-services   - Start Docker services (backend, workspace)"
	@echo "  make dev-frontend   - Start frontend (Vite)"
	@echo "  make dev-backend    - Start backend (native Go, local mode)"
	@echo "  make dev-real       - Start backend against real Fly VMs + Supabase"
	@echo ""
	@echo "Supabase:"
	@echo "  make supabase-start - Start local Supabase"
	@echo "  make supabase-stop  - Stop local Supabase"
	@echo "  make supabase-reset - Reset database"
	@echo "  make db-shell       - Open psql shell"
	@echo ""
	@echo "Utilities:"
	@echo "  make stop           - Stop all services"
	@echo "  make clean          - Stop all and remove volumes"
	@echo "  make logs           - Tail Docker logs"

# ===========================================
# Setup
# ===========================================

setup: check
	@echo "Setting up Aether development environment..."
	@echo ""
	@if [ ! -f .keys/aether_rsa ]; then \
		./scripts/generate-ssh-key.sh; \
	else \
		echo "SSH keys already exist"; \
	fi
	@echo ""
	@echo "Creating .env files with local config..."
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env; \
		echo "  Created backend/.env"; \
	fi
	@if [ ! -f frontend/.env ]; then \
		cp frontend/.env.example frontend/.env; \
		echo "  Created frontend/.env"; \
	fi
	@if [ ! -f workspace-service/.env ]; then \
		cp workspace-service/.env.example workspace-service/.env; \
		echo "  Created workspace-service/.env"; \
	fi
	@echo ""
	@echo "Installing dependencies..."
	@cd frontend && pnpm install
	@cd workspace-service && bun install
	@echo ""
	@echo "Setup complete! Run 'make dev' to start."

check:
	@echo "Checking prerequisites..."
	@command -v go >/dev/null 2>&1 || { echo "ERROR: go is not installed"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm is not installed (npm install -g pnpm)"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed"; exit 1; }
	@command -v supabase >/dev/null 2>&1 || { echo "ERROR: supabase CLI not installed (brew install supabase/tap/supabase)"; exit 1; }
	@command -v bun >/dev/null 2>&1 || { echo "WARNING: bun not installed (needed for workspace-service)"; }
	@echo "All prerequisites met!"

# ===========================================
# Development (uses .env files, no Infisical)
# ===========================================

dev: supabase-start dev-services dev-frontend

dev-services:
	@echo "Starting Docker services..."
	LOCAL_PROJECT_DIR=$(shell pwd)/workspace-service/test-project \
	LOCAL_WORKSPACE_SERVICE_DIR=$(shell pwd)/workspace-service \
	docker compose up -d --build
	@echo ""
	@echo "Services started:"
	@echo "  - Backend:   http://localhost:8080"
	@echo "  - Workspace: ws://localhost:3001"
	@echo ""
	@echo "Run 'make logs' to see logs"

dev-frontend:
	@echo "Starting frontend..."
	cd frontend && pnpm dev

dev-backend:
	@echo "Starting backend (native Go, local mode)..."
	cd backend && go run .

dev-real:
	@echo "Starting against real infrastructure..."
	@echo "Using Infisical for secrets (Fly VMs + real Supabase)"
	infisical run --env=prod --path=/backend -- sh -c "cd backend && go run ." & \
	infisical run --env=prod --path=/frontend -- sh -c "cd frontend && VITE_API_URL=http://localhost:8080 pnpm dev"

# ===========================================
# Supabase
# ===========================================

supabase-start:
	@echo "Starting local Supabase..."
	@supabase start || true
	@echo ""
	@echo "Supabase running at:"
	@echo "  - API:    http://localhost:54321"
	@echo "  - Studio: http://localhost:54323"

supabase-stop:
	supabase stop

supabase-status:
	supabase status

supabase-reset:
	supabase db reset

db-shell:
	psql postgresql://postgres:postgres@localhost:54322/postgres

# ===========================================
# Utilities
# ===========================================

stop:
	docker compose down
	supabase stop

clean:
	docker compose down -v
	supabase stop
	@echo "All services stopped and volumes removed"

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-workspace:
	docker compose logs -f workspace
