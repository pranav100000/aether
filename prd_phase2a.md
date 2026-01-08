# Phase 2a PRD: Database & Auth Foundation

**Project:** aether
**Phase:** 2a of 2a-2d
**Goal:** Set up Supabase, database schema, and backend auth middleware

---

## Overview

Phase 2a establishes the foundation for user authentication and data persistence. This is the critical infrastructure that all subsequent phases depend on. By the end of this phase:

1. Supabase project is configured with auth providers
2. Database schema is deployed with proper RLS policies
3. Backend can validate JWTs and query the database
4. Auth middleware protects all endpoints

This phase is backend-focused. No frontend changes yet.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| JWT validation | Correctly validates Supabase tokens |
| Invalid token rejection | Returns 401 with clear error |
| Database queries | Can CRUD profiles and projects |
| RLS enforcement | Users can only see their own data |
| Profile auto-creation | New signup creates profile row |

---

## Prerequisites

Before starting implementation, you must:

1. **Create Supabase Project**
   - Go to https://supabase.com and create a new project
   - Note down: Project URL, Anon Key, Service Role Key
   - Enable Email auth provider (disable email confirmation for dev)
   - Enable GitHub OAuth provider (optional, can add later)

2. **Update Environment Variables**
   Add to `.env`:
   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_KEY=eyJ...
   SUPABASE_JWT_SECRET=your-jwt-secret
   ```

   The JWT secret can be found in Supabase Dashboard → Settings → API → JWT Secret

---

## Technical Requirements

### 1. Database Schema

Create migration file: `supabase/migrations/001_initial_schema.sql`

**Profiles Table:**
```sql
-- Profiles (extends Supabase auth.users)
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null
);

-- Index for email lookups
create index profiles_email_idx on public.profiles(email);
```

**Projects Table:**
```sql
-- Projects
create table public.projects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    description text,

    -- VM state
    fly_machine_id text,
    fly_volume_id text,
    status text default 'stopped' not null
        check (status in ('stopped', 'starting', 'running', 'stopping', 'error')),
    error_message text,

    -- Config
    base_image text default 'base',
    env_vars jsonb default '{}',

    -- Metadata
    last_accessed_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    -- Constraints
    constraint projects_name_length check (char_length(name) >= 1 and char_length(name) <= 100)
);

-- Indexes
create index projects_user_id_idx on public.projects(user_id);
create index projects_status_idx on public.projects(status);
create index projects_fly_machine_id_idx on public.projects(fly_machine_id);
```

**Row Level Security:**
```sql
-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.projects enable row level security;

-- Profiles policies
create policy "Users can view own profile"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Projects policies
create policy "Users can view own projects"
    on public.projects for select
    using (auth.uid() = user_id);

create policy "Users can create own projects"
    on public.projects for insert
    with check (auth.uid() = user_id);

create policy "Users can update own projects"
    on public.projects for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete own projects"
    on public.projects for delete
    using (auth.uid() = user_id);
```

**Triggers:**
```sql
-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Auto-update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_updated_at
    before update on public.profiles
    for each row execute function public.update_updated_at();

create trigger projects_updated_at
    before update on public.projects
    for each row execute function public.update_updated_at();
```

**Acceptance criteria:**
- [ ] Migration runs without errors in Supabase
- [ ] Creating a user in auth.users auto-creates profile
- [ ] updated_at auto-updates on row changes
- [ ] RLS prevents cross-user data access

---

### 2. Backend Database Client

Create new file: `backend/db/client.go`

**Responsibilities:**
- Connect to Supabase Postgres using connection string
- Provide typed query methods for profiles and projects
- Handle connection pooling

**Implementation:**

```go
package db

import (
    "context"
    "fmt"
    "time"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

type Client struct {
    pool *pgxpool.Pool
}

type Profile struct {
    ID          string    `json:"id"`
    Email       string    `json:"email"`
    DisplayName *string   `json:"display_name"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}

type Project struct {
    ID             string     `json:"id"`
    UserID         string     `json:"user_id"`
    Name           string     `json:"name"`
    Description    *string    `json:"description,omitempty"`
    FlyMachineID   *string    `json:"fly_machine_id,omitempty"`
    FlyVolumeID    *string    `json:"fly_volume_id,omitempty"`
    Status         string     `json:"status"`
    ErrorMessage   *string    `json:"error_message,omitempty"`
    BaseImage      string     `json:"base_image"`
    EnvVars        any        `json:"env_vars"`
    LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
    CreatedAt      time.Time  `json:"created_at"`
    UpdatedAt      time.Time  `json:"updated_at"`
}

func NewClient(databaseURL string) (*Client, error) {
    config, err := pgxpool.ParseConfig(databaseURL)
    if err != nil {
        return nil, fmt.Errorf("failed to parse database URL: %w", err)
    }

    // Connection pool settings
    config.MaxConns = 10
    config.MinConns = 2
    config.MaxConnLifetime = time.Hour
    config.MaxConnIdleTime = 30 * time.Minute

    pool, err := pgxpool.NewWithConfig(context.Background(), config)
    if err != nil {
        return nil, fmt.Errorf("failed to create connection pool: %w", err)
    }

    // Verify connection
    if err := pool.Ping(context.Background()); err != nil {
        return nil, fmt.Errorf("failed to ping database: %w", err)
    }

    return &Client{pool: pool}, nil
}

func (c *Client) Close() {
    c.pool.Close()
}

// Profile methods
func (c *Client) GetProfile(ctx context.Context, userID string) (*Profile, error)
func (c *Client) UpdateProfile(ctx context.Context, userID string, displayName string) error

// Project methods (to be implemented in Phase 2b)
func (c *Client) ListProjects(ctx context.Context, userID string) ([]Project, error)
func (c *Client) GetProject(ctx context.Context, projectID string) (*Project, error)
func (c *Client) GetProjectByUser(ctx context.Context, projectID, userID string) (*Project, error)
func (c *Client) CreateProject(ctx context.Context, project *Project) error
func (c *Client) UpdateProject(ctx context.Context, project *Project) error
func (c *Client) DeleteProject(ctx context.Context, projectID string) error
func (c *Client) UpdateProjectStatus(ctx context.Context, projectID, status string, errorMsg *string) error
func (c *Client) UpdateProjectMachine(ctx context.Context, projectID, machineID string) error
func (c *Client) UpdateProjectLastAccessed(ctx context.Context, projectID string) error
```

**Environment variable:**
```
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
```

The connection string is found in Supabase Dashboard → Settings → Database → Connection string (URI)

**Acceptance criteria:**
- [ ] Client connects to Supabase Postgres
- [ ] Connection pool works correctly
- [ ] GetProfile returns correct data
- [ ] Queries use parameterized statements (no SQL injection)

---

### 3. JWT Auth Middleware

Create new file: `backend/middleware/auth.go`

**Responsibilities:**
- Extract JWT from Authorization header
- Validate JWT signature using Supabase JWT secret
- Extract user ID from claims
- Attach user context to request
- Return 401 for invalid/missing tokens

**Implementation:**

```go
package middleware

import (
    "context"
    "net/http"
    "strings"

    "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "user_id"

type AuthMiddleware struct {
    jwtSecret []byte
}

func NewAuthMiddleware(jwtSecret string) *AuthMiddleware {
    return &AuthMiddleware{
        jwtSecret: []byte(jwtSecret),
    }
}

func (m *AuthMiddleware) Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Extract token from Authorization header
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" {
            http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
            return
        }

        // Expect "Bearer <token>"
        parts := strings.Split(authHeader, " ")
        if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
            http.Error(w, `{"error":"invalid authorization header format"}`, http.StatusUnauthorized)
            return
        }

        tokenString := parts[1]

        // Parse and validate token
        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            // Validate signing method
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
            }
            return m.jwtSecret, nil
        })

        if err != nil || !token.Valid {
            http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
            return
        }

        // Extract user ID from claims
        claims, ok := token.Claims.(jwt.MapClaims)
        if !ok {
            http.Error(w, `{"error":"invalid token claims"}`, http.StatusUnauthorized)
            return
        }

        userID, ok := claims["sub"].(string)
        if !ok || userID == "" {
            http.Error(w, `{"error":"invalid user id in token"}`, http.StatusUnauthorized)
            return
        }

        // Add user ID to context
        ctx := context.WithValue(r.Context(), UserIDKey, userID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Helper to get user ID from context
func GetUserID(ctx context.Context) string {
    userID, _ := ctx.Value(UserIDKey).(string)
    return userID
}
```

**Acceptance criteria:**
- [ ] Valid Supabase JWT passes through
- [ ] Missing token returns 401
- [ ] Invalid token returns 401
- [ ] Expired token returns 401
- [ ] User ID correctly extracted and available in handlers

---

### 4. Update Main Server

Update `backend/main.go` to:

1. Load new environment variables (SUPABASE_JWT_SECRET, DATABASE_URL)
2. Initialize database client
3. Initialize auth middleware
4. Apply auth middleware to protected routes
5. Keep /health endpoint public

**Updated route structure:**
```go
// Public routes
r.Get("/health", healthHandler)

// Protected routes (require auth)
r.Group(func(r chi.Router) {
    r.Use(authMiddleware.Authenticate)

    // Projects (Phase 2b)
    r.Route("/projects", func(r chi.Router) {
        r.Get("/", projectHandler.List)
        r.Post("/", projectHandler.Create)
        r.Get("/{id}", projectHandler.Get)
        r.Patch("/{id}", projectHandler.Update)
        r.Delete("/{id}", projectHandler.Delete)
        r.Post("/{id}/start", projectHandler.Start)
        r.Post("/{id}/stop", projectHandler.Stop)
        r.Get("/{id}/terminal", terminalHandler.HandleTerminal)
    })
})
```

**Acceptance criteria:**
- [ ] Server starts with new config
- [ ] /health works without auth
- [ ] Protected routes require valid token
- [ ] Database client initializes on startup

---

## File Structure After Phase 2a

```
backend/
├── main.go                 # Updated with auth + db init
├── go.mod                  # Updated with new deps
├── go.sum
├── fly/
│   └── client.go
├── ssh/
│   └── client.go
├── handlers/
│   ├── machines.go         # Will be deprecated in 2b
│   └── terminal.go         # Will be updated in 2b
├── middleware/
│   └── auth.go             # NEW
└── db/
    └── client.go           # NEW

supabase/
└── migrations/
    └── 001_initial_schema.sql  # NEW
```

---

## Dependencies

**New Go packages:**
```
github.com/jackc/pgx/v5
github.com/golang-jwt/jwt/v5
```

Add to go.mod:
```bash
cd backend
go get github.com/jackc/pgx/v5
go get github.com/golang-jwt/jwt/v5
```

---

## Testing Plan

### Manual Testing Steps

1. **Database Migration:**
   ```bash
   # In Supabase Dashboard → SQL Editor, run the migration
   # Or use Supabase CLI:
   supabase db push
   ```

2. **Create Test User:**
   - Go to Supabase Dashboard → Authentication → Users
   - Click "Add user" → Create with email/password
   - Verify profile row was auto-created in profiles table

3. **Get JWT Token:**
   ```bash
   # Use Supabase client or curl to sign in
   curl -X POST 'https://[project].supabase.co/auth/v1/token?grant_type=password' \
     -H 'apikey: [anon-key]' \
     -H 'Content-Type: application/json' \
     -d '{"email":"test@example.com","password":"testpass123"}'
   ```

4. **Test Auth Middleware:**
   ```bash
   # Without token (should fail)
   curl http://localhost:8080/projects
   # Expected: 401 Unauthorized

   # With valid token (should succeed, empty list for now)
   curl http://localhost:8080/projects \
     -H 'Authorization: Bearer [jwt-token]'
   # Expected: 200 OK (or stub response)

   # With invalid token (should fail)
   curl http://localhost:8080/projects \
     -H 'Authorization: Bearer invalid-token'
   # Expected: 401 Unauthorized
   ```

5. **Test Database Connection:**
   - Add a temporary debug endpoint or log statement
   - Verify pool connects and queries work

---

## Environment Variables Summary

Add these to `.env`:

```bash
# Supabase
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret-from-dashboard

# Database
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
```

Update `.env.example` to include these (without real values).

---

## Definition of Done

Phase 2a is complete when:

1. [ ] Supabase project created and configured
2. [ ] Database migration applied successfully
3. [ ] New user signup auto-creates profile
4. [ ] Backend connects to database on startup
5. [ ] Auth middleware validates JWTs correctly
6. [ ] Protected routes return 401 without valid token
7. [ ] Protected routes work with valid token
8. [ ] All environment variables documented

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| JWT secret mismatch | Copy exactly from Supabase dashboard |
| Database connection issues | Test connection string in isolation first |
| RLS blocks backend queries | Use service role key for backend, or set role in connection |
| Profile trigger fails | Test signup flow immediately after migration |

---

## Notes

- The backend should use the **service role key** or direct database connection to bypass RLS when needed for admin operations
- For user-scoped queries, we'll pass the user_id and let the query filter by it
- We're not implementing the full project CRUD yet - just the infrastructure. Project handlers come in Phase 2b
