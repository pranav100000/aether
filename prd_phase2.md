# Phase 2 PRD: Product Foundation

**Project:** aether (working title)
**Phase:** 2 of 5
**Timeline:** Weeks 3-4
**Goal:** Wrap the core infrastructure in a real product with auth, persistence, and a usable UI

---

## Overview

Phase 1 proved the core works. Phase 2 turns it into something people can actually use. By the end of this phase, a user should be able to:

1. Sign up / log in
2. Create a project
3. Open the project and get a terminal
4. Close the tab, come back later, and their project still exists
5. Delete projects they don't need

This is the minimum viable product — not feature-rich, but complete enough that someone could use it for real work.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Sign up → terminal | <60 seconds for new user |
| Project creation | <5 seconds (VM starts in background) |
| Return to existing project | <3 seconds to terminal |
| Data integrity | No lost projects, no orphaned VMs |
| Auth security | No obvious vulnerabilities |

---

## Technical Requirements

### 1. Supabase Setup

Configure Supabase as our backend-as-a-service.

**Services to enable:**
- Authentication (email + GitHub OAuth)
- Database (Postgres)
- Row Level Security (RLS)

**Auth providers:**
- Email/password (with email confirmation disabled for now)
- GitHub OAuth

**Environment variables:**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx  # For backend only
```

**Acceptance criteria:**
- Can sign up with email/password
- Can sign in with GitHub
- JWT tokens work correctly
- Service key can bypass RLS for backend operations

---

### 2. Database Schema

Implement the data model in Supabase Postgres.

**Tables:**

```sql
-- Profiles (extends Supabase auth.users)
create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Projects
create table projects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id) on delete cascade,
    name text not null,
    description text,
    
    -- VM state
    fly_machine_id text,
    fly_volume_id text,
    status text default 'stopped' check (status in ('stopped', 'starting', 'running', 'stopping', 'error')),
    
    -- Config
    base_image text default 'base',
    env_vars jsonb default '{}',
    
    -- Metadata
    last_accessed_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Indexes
create index projects_user_id_idx on projects(user_id);
create index projects_status_idx on projects(status);
```

**Row Level Security:**

```sql
-- Profiles: users can only read/update their own
alter table profiles enable row level security;

create policy "Users can view own profile"
    on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
    on profiles for update using (auth.uid() = id);

-- Projects: users can only access their own
alter table projects enable row level security;

create policy "Users can view own projects"
    on projects for select using (auth.uid() = user_id);

create policy "Users can create own projects"
    on projects for insert with check (auth.uid() = user_id);

create policy "Users can update own projects"
    on projects for update using (auth.uid() = user_id);

create policy "Users can delete own projects"
    on projects for delete using (auth.uid() = user_id);
```

**Triggers:**

```sql
-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, display_name)
    values (new.id, new.email, split_part(new.email, '@', 1));
    return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
    before update on projects
    for each row execute function update_updated_at();
```

**Acceptance criteria:**
- All tables created with correct constraints
- RLS policies work (tested manually)
- Profile auto-created on signup
- updated_at auto-updates

---

### 3. Backend API Updates

Extend the Go backend to integrate with Supabase and manage projects.

**New endpoints:**

```
# Projects
GET    /projects              List user's projects
POST   /projects              Create new project
GET    /projects/:id          Get project details
PATCH  /projects/:id          Update project
DELETE /projects/:id          Delete project (and destroy VM)

# Project actions
POST   /projects/:id/start    Start project VM
POST   /projects/:id/stop     Stop project VM
GET    /projects/:id/terminal WebSocket terminal connection
```

**Authentication:**
- All endpoints require valid Supabase JWT in `Authorization: Bearer <token>` header
- Backend validates JWT using Supabase public key
- Extract `user_id` from JWT claims for RLS

**Project lifecycle:**

```
User creates project
        ↓
Row inserted in DB (status: stopped, no fly_machine_id)
        ↓
User opens project
        ↓
Backend creates Fly Machine if needed
        ↓
Store fly_machine_id in DB
        ↓
Start machine, update status to 'running'
        ↓
Return terminal WebSocket URL
        ↓
User closes tab
        ↓
After 10 min idle → stop machine, status: 'stopped'
        ↓
User deletes project
        ↓
Destroy Fly Machine, delete DB row
```

**Error handling:**
- If Fly API fails during start, set status to 'error'
- Include error message in response
- Allow retry (POST /start again)

**Acceptance criteria:**
- All endpoints work with valid JWT
- Unauthorized requests rejected with 401
- Users can only access their own projects
- Project status accurately reflects VM state
- Deleting project cleans up Fly Machine

---

### 4. Frontend Application

Build a React application with auth and project management.

**Tech stack:**
- React 18 + TypeScript
- Vite for bundling
- Tailwind CSS for styling
- Supabase JS client for auth
- xterm.js for terminal (from Phase 1)

**Pages/Routes:**

```
/login          Login page (email + GitHub)
/signup         Signup page
/projects       Project list (dashboard)
/projects/:id   Project workspace (terminal)
```

**Components:**

```
src/
├── components/
│   ├── AuthForm.tsx        # Login/signup form
│   ├── ProjectCard.tsx     # Project in list view
│   ├── ProjectList.tsx     # Grid of projects
│   ├── Terminal.tsx        # xterm.js wrapper
│   ├── StatusBadge.tsx     # Project status indicator
│   └── Layout.tsx          # App shell with nav
├── pages/
│   ├── Login.tsx
│   ├── Signup.tsx
│   ├── Projects.tsx
│   └── Workspace.tsx
├── hooks/
│   ├── useAuth.ts          # Auth state management
│   └── useProjects.ts      # Project CRUD
├── lib/
│   ├── supabase.ts         # Supabase client
│   └── api.ts              # Backend API client
└── App.tsx                 # Router setup
```

**Auth flow:**
1. User lands on `/login` (or redirected if not authenticated)
2. Signs in with email/password or GitHub
3. Supabase returns JWT
4. Store JWT in memory (not localStorage for security)
5. Include JWT in all API requests
6. On page refresh, use Supabase's `getSession()` to restore

**Project list page (`/projects`):**

```
┌─────────────────────────────────────────────────────────────┐
│  🔨 aether                                    [user@email ▼] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Your Projects                          [+ New Project]     │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ my-api          │  │ experiment      │                  │
│  │ ● Running       │  │ ○ Stopped       │                  │
│  │                 │  │                 │                  │
│  │ Last: 2 min ago │  │ Last: 3 days    │                  │
│  │ [Open] [Delete] │  │ [Open] [Delete] │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Workspace page (`/projects/:id`):**

```
┌─────────────────────────────────────────────────────────────┐
│  🔨 aether  /  my-api                    ● Running   [Stop]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  coder@aether:~/project$ npm install                         │
│  added 150 packages in 4s                                   │
│  coder@aether:~/project$ npm run dev                         │
│  Server running on http://localhost:3000                    │
│  █                                                          │
│                                                             │
│                                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**States to handle:**
- Loading (fetching project, starting VM)
- Running (terminal connected)
- Stopped (show "Start" button)
- Error (show error message, retry button)
- Reconnecting (terminal lost connection)

**Acceptance criteria:**
- Can sign up, log in, log out
- Can create project with name
- Project list shows all user's projects
- Clicking project opens workspace
- Terminal connects and works
- Can stop running project
- Can delete project (with confirmation)
- Responsive on mobile (terminal still usable)

---

## File Structure

```
aether/
├── backend/
│   ├── main.go
│   ├── go.mod
│   ├── handlers/
│   │   ├── projects.go      # Project CRUD
│   │   └── terminal.go      # WebSocket (updated)
│   ├── middleware/
│   │   └── auth.go          # JWT validation
│   ├── db/
│   │   └── client.go        # Supabase/Postgres client
│   ├── fly/
│   │   └── client.go
│   └── ssh/
│       └── client.go
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── App.tsx
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
├── infra/
│   └── images/
│       └── base/
│           └── Dockerfile
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
└── README.md
```

---

## Dependencies

**Backend (new):**
- `github.com/jackc/pgx/v5` — Postgres driver
- `github.com/golang-jwt/jwt/v5` — JWT validation

**Frontend:**
- `react`, `react-dom`, `react-router-dom`
- `@supabase/supabase-js`
- `xterm`, `xterm-addon-fit`, `xterm-addon-webgl`
- `tailwindcss`, `postcss`, `autoprefixer`
- `typescript`, `vite`

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Supabase auth edge cases (token refresh, etc.) | Medium | Medium | Use Supabase JS client which handles this |
| Orphaned VMs (DB row deleted but VM still running) | Medium | High | Add cleanup cron job, check on startup |
| JWT validation bugs | Low | High | Use well-tested library, add tests |
| State sync issues (DB says running, VM is stopped) | Medium | Medium | Always check Fly API as source of truth |

---

## Out of Scope for Phase 2

- File editor (CodeMirror) — Phase 3
- Port forwarding / preview URLs — Phase 3
- Multiple base images / language selection — Phase 3
- Agent connections (SSH gateway) — Phase 4
- Billing / usage tracking — Phase 5
- Teams / collaboration — Future
- Environment variables UI — Future

---

## Task Breakdown

### Week 3

| Task | Estimate | Owner |
|------|----------|-------|
| Supabase project setup | 2 hours | — |
| Configure auth providers (email, GitHub) | 2 hours | — |
| Write and run database migrations | 3 hours | — |
| Set up RLS policies | 2 hours | — |
| Backend: Supabase/Postgres client | 3 hours | — |
| Backend: JWT auth middleware | 4 hours | — |
| Backend: Project CRUD endpoints | 6 hours | — |
| Backend: Update terminal endpoint for projects | 3 hours | — |
| Manual API testing | 2 hours | — |

### Week 4

| Task | Estimate | Owner |
|------|----------|-------|
| Frontend: Vite + React + Tailwind setup | 2 hours | — |
| Frontend: Supabase client + auth hooks | 3 hours | — |
| Frontend: Login/Signup pages | 4 hours | — |
| Frontend: Project list page | 4 hours | — |
| Frontend: Workspace page with terminal | 6 hours | — |
| Frontend: Loading/error states | 3 hours | — |
| Integration testing (auth → projects → terminal) | 4 hours | — |
| Bug fixes and polish | 4 hours | — |
| Deploy frontend (Vercel or Fly) | 2 hours | — |

**Total estimated hours:** ~59 hours

---

## Definition of Done

Phase 2 is complete when:

1. ✅ New user can sign up with email or GitHub
2. ✅ Logged-in user sees empty project list
3. ✅ User can create a project with a name
4. ✅ User can open project and get a working terminal
5. ✅ User can close tab, return later, project still exists
6. ✅ User can stop a running project
7. ✅ User can delete a project (VM is cleaned up)
8. ✅ User cannot see other users' projects
9. ✅ Frontend is deployed and accessible via URL

---

## Design Decisions

1. **JWT storage:** Keep JWT in memory only, not localStorage. Use Supabase's built-in session management for refresh. This is more secure against XSS attacks.

2. **VM creation timing:** Create Fly Machine on first "open," not on project creation. This avoids paying for VMs that are created but never used.

3. **Status source of truth:** Database status is a cache. Always verify against Fly API when user opens a project. Update DB if mismatched.

4. **Orphan cleanup:** Add a background job that runs on backend startup (and hourly) to find VMs without matching DB rows and destroy them.

5. **Error recovery:** If a project is in 'error' state, allow user to click "Retry" which will attempt to create/start the VM again.

---

## API Reference

### Authentication

All endpoints except health check require authentication.

```
Authorization: Bearer <supabase_jwt>
```

### Endpoints

**List projects**
```
GET /projects

Response 200:
{
  "projects": [
    {
      "id": "uuid",
      "name": "my-project",
      "status": "running",
      "last_accessed_at": "2024-01-15T...",
      "created_at": "2024-01-10T..."
    }
  ]
}
```

**Create project**
```
POST /projects
{
  "name": "my-project",
  "description": "optional"
}

Response 201:
{
  "id": "uuid",
  "name": "my-project",
  "status": "stopped",
  ...
}
```

**Get project**
```
GET /projects/:id

Response 200:
{
  "id": "uuid",
  "name": "my-project",
  "status": "running",
  "fly_machine_id": "abc123",
  ...
}
```

**Update project**
```
PATCH /projects/:id
{
  "name": "new-name"
}

Response 200:
{ ... updated project ... }
```

**Delete project**
```
DELETE /projects/:id

Response 204 (no content)
```

**Start project**
```
POST /projects/:id/start

Response 200:
{
  "status": "running",
  "terminal_url": "wss://api.aether.dev/projects/:id/terminal"
}
```

**Stop project**
```
POST /projects/:id/stop

Response 200:
{
  "status": "stopped"
}
```

**Terminal WebSocket**
```
GET /projects/:id/terminal
Upgrade: websocket

(Same protocol as Phase 1)
```
