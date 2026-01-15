.PHONY: help setup dev dev-services dev-frontend dev-backend stop clean clean-vms logs check
.PHONY: dev-real dev-api-real dev-gateway-real dev-web-real
.PHONY: supabase-start supabase-stop supabase-status supabase-reset db-shell
.PHONY: fmt fmt-go fmt-ts lint lint-go lint-ts

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
	@echo "  make dev-services   - Start Docker services (backend)"
	@echo "  make dev-frontend   - Start frontend (Vite)"
	@echo "  make dev-backend    - Start backend (native Go, local mode)"
	@echo ""
	@echo "Development (real infra via Infisical):"
	@echo "  make dev-real       - Start API + Web against real infrastructure"
	@echo "  make dev-api-real   - Start API only (secrets from /common + /api)"
	@echo "  make dev-gateway-real - Start Gateway only (secrets from /common + /gateway)"
	@echo "  make dev-web-real   - Start Web only (secrets from /common + /web)"
	@echo ""
	@echo "Supabase:"
	@echo "  make supabase-start - Start local Supabase"
	@echo "  make supabase-stop  - Stop local Supabase"
	@echo "  make supabase-reset - Reset database"
	@echo "  make db-shell       - Open psql shell"
	@echo ""
	@echo "Linting & Formatting:"
	@echo "  make fmt            - Format all code (Go + TypeScript)"
	@echo "  make fmt-go         - Format Go code"
	@echo "  make fmt-ts         - Format TypeScript code"
	@echo "  make lint           - Lint all code (Go + TypeScript)"
	@echo "  make lint-go        - Lint Go code"
	@echo "  make lint-ts        - Lint TypeScript code"
	@echo ""
	@echo "Utilities:"
	@echo "  make stop           - Stop all services"
	@echo "  make clean          - Stop all and remove volumes"
	@echo "  make clean-vms      - Remove local VM containers"
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
	@if [ ! -f apps/api/.env ]; then \
		cp apps/api/.env.example apps/api/.env; \
		echo "  Created apps/api/.env"; \
	fi
	@if [ ! -f apps/web/.env ]; then \
		cp apps/web/.env.example apps/web/.env; \
		echo "  Created apps/web/.env"; \
	fi
	@if [ ! -f apps/workspace-service/.env ]; then \
		cp apps/workspace-service/.env.example apps/workspace-service/.env; \
		echo "  Created apps/workspace-service/.env"; \
	fi
	@echo ""
	@echo "Installing dependencies..."
	@bun install
	@echo ""
	@echo "Setup complete! Run 'make dev' to start."

check:
	@echo "Checking prerequisites..."
	@command -v go >/dev/null 2>&1 || { echo "ERROR: go is not installed"; exit 1; }
	@command -v bun >/dev/null 2>&1 || { echo "ERROR: bun is not installed (curl -fsSL https://bun.sh/install | bash)"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed"; exit 1; }
	@command -v supabase >/dev/null 2>&1 || { echo "ERROR: supabase CLI not installed (brew install supabase/tap/supabase)"; exit 1; }
	@command -v golangci-lint >/dev/null 2>&1 || { echo "WARNING: golangci-lint not installed (brew install golangci-lint)"; }
	@command -v goimports >/dev/null 2>&1 || { echo "WARNING: goimports not installed (go install golang.org/x/tools/cmd/goimports@latest)"; }
	@echo "All prerequisites met!"

# ===========================================
# Development (uses .env files, no Infisical)
# ===========================================

dev: supabase-start dev-services dev-frontend

dev-services:
	@echo "Starting Docker services..."
	LOCAL_PROJECT_DIR=$(shell pwd)/apps/workspace-service/test-project \
	docker compose up -d --build
	@echo ""
	@echo "Services started:"
	@echo "  - Backend: http://localhost:8080"
	@echo "  - Gateway: http://localhost:8081 (preview URLs)"
	@echo ""
	@echo "Run 'make logs' to see logs"

dev-frontend:
	@echo "Starting frontend..."
	cd apps/web && npx vite --host

dev-backend:
	@echo "Starting backend (native Go, local mode)..."
	cd apps/api && go run .

dev-real:
	@echo "Starting against real infrastructure..."
	@echo "Using Infisical for secrets (Fly VMs + real Supabase)"
	@echo "Fetching secrets from /common + service-specific folders"
	infisical run --env=prod --path=/common --path=/api -- sh -c "cd apps/api && go run ." & \
	infisical run --env=prod --path=/common --path=/web -- sh -c "cd apps/web && VITE_API_URL=http://localhost:8080 bun run dev"

dev-api-real:
	@echo "Starting API against real infrastructure..."
	infisical run --env=prod --path=/common --path=/api -- sh -c "cd apps/api && go run ."

dev-gateway-real:
	@echo "Starting Gateway against real infrastructure..."
	infisical run --env=prod --path=/common --path=/gateway -- sh -c "cd apps/gateway && go run ."

dev-web-real:
	@echo "Starting Web against real infrastructure..."
	infisical run --env=prod --path=/common --path=/web -- sh -c "cd apps/web && bun run dev"

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

clean-vms:
	@echo "Removing local VM containers..."
	@docker ps -a --filter "name=local-aether-" --format "{{.Names}}" | xargs -r docker rm -f 2>/dev/null || true
	@echo "Done"

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

# ===========================================
# Linting & Formatting
# ===========================================

fmt: fmt-go fmt-ts

fmt-go:
	@echo "Formatting Go code..."
	@command -v goimports >/dev/null 2>&1 || { echo "ERROR: goimports not installed. Run: go install golang.org/x/tools/cmd/goimports@latest"; exit 1; }
	@gofmt -w -s apps/api apps/gateway libs/go
	@goimports -w -local aether apps/api apps/gateway libs/go

fmt-ts:
	@echo "Formatting TypeScript code..."
	@bun run fmt:ts

lint: lint-go lint-ts

lint-go:
	@echo "Linting Go code..."
	@command -v golangci-lint >/dev/null 2>&1 || { echo "ERROR: golangci-lint not installed. Run: brew install golangci-lint"; exit 1; }
	@golangci-lint run ./...

lint-ts:
	@echo "Linting TypeScript code..."
	@bun run lint:ts
