# Aether

Agent-agnostic cloud development environment. Spin up instant cloud VMs and connect via browser terminal or your preferred coding agent.

## Tech Stack

### Backend
- **Go** with Chi router
- **Fly.io** Machines API for VM orchestration
- **Supabase** for auth and database (Postgres)

### Frontend
- **Vite** + **React** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **React Router** for navigation
- **xterm.js** for terminal emulation

## Prerequisites

- Go 1.21+
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Docker
- Fly.io account with API token
- Supabase project

## Quick Start

### 1. Set up Fly.io

```bash
fly apps create aether-vms
```

### 2. Generate SSH keypair

```bash
chmod +x scripts/*.sh
./scripts/generate-ssh-key.sh
```

### 3. Build and push the base image

Add the public key to `infra/images/base/Dockerfile`:

```dockerfile
RUN echo "YOUR_PUBLIC_KEY_HERE" >> /home/coder/.ssh/authorized_keys
```

Then build and push:

```bash
./scripts/build-image.sh --push
```

### 4. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration in SQL Editor: `supabase/migrations/001_initial_schema.sql`
3. Copy your credentials to `.env`

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env with your Fly.io and Supabase credentials
```

### 6. Run the backend

```bash
cd backend
go mod tidy
go run .
```

### 7. Run the frontend

```bash
cd frontend
pnpm install
pnpm dev
```

## API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

### Protected (requires auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List user's projects |
| POST | `/projects` | Create a new project |
| GET | `/projects/:id` | Get project details |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| POST | `/projects/:id/start` | Start project VM |
| POST | `/projects/:id/stop` | Stop project VM |
| GET | `/projects/:id/terminal` | WebSocket terminal |

### Legacy (no auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/machines` | List all machines |
| POST | `/machines` | Create a machine |
| GET | `/machines/:id` | Get machine status |
| POST | `/machines/:id/start` | Start machine |
| POST | `/machines/:id/stop` | Stop machine |
| DELETE | `/machines/:id` | Destroy machine |
| GET | `/machines/:id/terminal` | WebSocket terminal |

## Project Structure

```
aether/
├── backend/
│   ├── main.go              # Entry point
│   ├── handlers/
│   │   ├── projects.go      # Project CRUD + start/stop
│   │   ├── machines.go      # Legacy machine CRUD
│   │   └── terminal.go      # WebSocket terminal
│   ├── middleware/
│   │   └── auth.go          # JWT auth middleware
│   ├── db/
│   │   └── client.go        # Postgres client
│   ├── fly/
│   │   └── client.go        # Fly.io API client
│   └── ssh/
│       └── client.go        # SSH client
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── hooks/           # Custom hooks
│   │   ├── lib/             # Utilities
│   │   └── pages/           # Page components
│   └── ...
├── infra/
│   └── images/
│       └── base/            # VM base image
├── supabase/
│   └── migrations/          # Database migrations
└── scripts/
    ├── build-image.sh
    ├── generate-ssh-key.sh
    └── deploy.sh
```

## Environment Variables

See [docs/ENV.md](docs/ENV.md) for complete environment variable documentation including:
- Required variables for production and local development
- Optional configuration with defaults
- Validation rules and configuration conflicts

## Development Phases

- [x] **Phase 1**: Core Infrastructure (VM orchestration + terminal)
- [x] **Phase 2a**: Database & Auth Foundation
- [x] **Phase 2b**: Backend Project API
- [x] **Phase 2c**: Frontend Foundation
- [x] **Phase 2d**: Frontend Features & Integration
- [ ] **Phase 3**: File editor (CodeMirror)
- [ ] **Phase 4**: Agent connections (SSH gateway)
- [ ] **Phase 5**: Billing (Stripe)
