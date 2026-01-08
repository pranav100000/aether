# Phase 2b PRD: Backend Project API

**Project:** aether
**Phase:** 2b of 2a-2d
**Depends on:** Phase 2a (Database & Auth Foundation)
**Goal:** Implement project CRUD endpoints and integrate terminal with project context

---

## Overview

Phase 2b builds the complete backend API for project management. By the end of this phase:

1. Users can create, list, read, update, and delete projects via API
2. Users can start/stop project VMs
3. Terminal connections are scoped to projects (not raw machine IDs)
4. Project status accurately reflects VM state
5. Deleting a project cleans up the associated Fly Machine

The old `/machines` endpoints will be deprecated in favor of `/projects`.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Project CRUD | All operations work correctly |
| Authorization | Users can only access their own projects |
| VM lifecycle | Start/stop correctly manages Fly Machines |
| Status sync | Project status reflects actual VM state |
| Cleanup | Delete project destroys VM if exists |
| Terminal | WebSocket works via project endpoint |

---

## Prerequisites

- Phase 2a complete (auth middleware, database client working)
- Valid Supabase JWT token for testing
- Fly.io credentials configured

---

## API Specification

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /projects | List user's projects |
| POST | /projects | Create new project |
| GET | /projects/:id | Get project details |
| PATCH | /projects/:id | Update project |
| DELETE | /projects/:id | Delete project |
| POST | /projects/:id/start | Start project VM |
| POST | /projects/:id/stop | Stop project VM |
| GET | /projects/:id/terminal | WebSocket terminal |

All endpoints require `Authorization: Bearer <token>` header.

---

### Endpoint Details

#### List Projects
```
GET /projects

Response 200:
{
    "projects": [
        {
            "id": "uuid",
            "name": "my-project",
            "description": "Optional description",
            "status": "running",
            "last_accessed_at": "2024-01-15T10:30:00Z",
            "created_at": "2024-01-10T08:00:00Z"
        }
    ]
}
```

#### Create Project
```
POST /projects
Content-Type: application/json

{
    "name": "my-project",
    "description": "Optional description"
}

Response 201:
{
    "id": "uuid",
    "name": "my-project",
    "description": "Optional description",
    "status": "stopped",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
}

Errors:
- 400: Invalid request body or name too long/short
- 401: Unauthorized
```

#### Get Project
```
GET /projects/:id

Response 200:
{
    "id": "uuid",
    "name": "my-project",
    "description": "Optional description",
    "status": "running",
    "fly_machine_id": "abc123",
    "base_image": "base",
    "last_accessed_at": "2024-01-15T10:30:00Z",
    "created_at": "2024-01-10T08:00:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
}

Errors:
- 401: Unauthorized
- 404: Project not found (or belongs to different user)
```

#### Update Project
```
PATCH /projects/:id
Content-Type: application/json

{
    "name": "new-name",
    "description": "New description"
}

Response 200:
{
    // Updated project object
}

Errors:
- 400: Invalid request body
- 401: Unauthorized
- 404: Project not found
```

#### Delete Project
```
DELETE /projects/:id

Response 204 (No Content)

Side effects:
- If fly_machine_id exists, destroy the Fly Machine
- Delete project row from database

Errors:
- 401: Unauthorized
- 404: Project not found
- 500: Failed to destroy VM (project still deleted from DB)
```

#### Start Project
```
POST /projects/:id/start

Response 200:
{
    "status": "running",
    "terminal_url": "wss://api.aether.dev/projects/{id}/terminal"
}

Behavior:
1. If no fly_machine_id: create new Fly Machine, store ID
2. If fly_machine_id exists: start the existing machine
3. Wait for machine to reach "started" state
4. Update project status to "running"
5. Update last_accessed_at

Errors:
- 401: Unauthorized
- 404: Project not found
- 500: Failed to start VM (status set to "error")
```

#### Stop Project
```
POST /projects/:id/stop

Response 200:
{
    "status": "stopped"
}

Behavior:
1. Stop the Fly Machine
2. Update project status to "stopped"

Errors:
- 401: Unauthorized
- 404: Project not found
- 400: Project has no VM to stop
- 500: Failed to stop VM
```

#### Terminal WebSocket
```
GET /projects/:id/terminal
Upgrade: websocket

Behavior:
1. Verify project exists and belongs to user
2. If project not running, return error
3. Establish SSH connection to VM
4. Proxy terminal I/O

WebSocket Messages (same as Phase 1):
- Input: {"type": "input", "data": "..."}
- Output: {"type": "output", "data": "..."}
- Resize: {"type": "resize", "cols": 80, "rows": 24}
- Error: {"type": "error", "data": "..."}

Errors:
- 401: Unauthorized (no upgrade)
- 404: Project not found
- 400: Project not running
```

---

## Technical Requirements

### 1. Project Handler

Create new file: `backend/handlers/projects.go`

```go
package handlers

import (
    "encoding/json"
    "net/http"
    "time"

    "aether/db"
    "aether/fly"
    "aether/middleware"

    "github.com/go-chi/chi/v5"
)

type ProjectHandler struct {
    db        *db.Client
    fly       *fly.Client
    baseImage string
}

func NewProjectHandler(db *db.Client, fly *fly.Client, baseImage string) *ProjectHandler {
    return &ProjectHandler{
        db:        db,
        fly:       fly,
        baseImage: baseImage,
    }
}

// Request/Response types

type CreateProjectRequest struct {
    Name        string `json:"name"`
    Description string `json:"description,omitempty"`
}

type UpdateProjectRequest struct {
    Name        *string `json:"name,omitempty"`
    Description *string `json:"description,omitempty"`
}

type ProjectResponse struct {
    ID             string     `json:"id"`
    Name           string     `json:"name"`
    Description    *string    `json:"description,omitempty"`
    Status         string     `json:"status"`
    FlyMachineID   *string    `json:"fly_machine_id,omitempty"`
    BaseImage      string     `json:"base_image,omitempty"`
    LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
    CreatedAt      time.Time  `json:"created_at"`
    UpdatedAt      time.Time  `json:"updated_at"`
}

type ProjectListResponse struct {
    Projects []ProjectResponse `json:"projects"`
}

type StartResponse struct {
    Status      string `json:"status"`
    TerminalURL string `json:"terminal_url"`
}

type StopResponse struct {
    Status string `json:"status"`
}

// Handlers

func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Update(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Delete(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Start(w http.ResponseWriter, r *http.Request)
func (h *ProjectHandler) Stop(w http.ResponseWriter, r *http.Request)
```

**Key implementation details:**

1. **Authorization:** Every handler must:
   - Get user ID from context: `middleware.GetUserID(r.Context())`
   - Query only that user's projects
   - Return 404 (not 403) if project belongs to different user (prevents enumeration)

2. **Start handler logic:**
   ```
   1. Get project from DB (scoped to user)
   2. If no fly_machine_id:
      a. Create Fly Machine with project ID as name prefix
      b. Store fly_machine_id in DB
   3. If fly_machine_id exists:
      a. Get machine status from Fly API
      b. If already running, just return success
   4. Start the machine
   5. Wait for "started" state (with timeout)
   6. Update project status to "running"
   7. Update last_accessed_at
   8. Return terminal URL
   ```

3. **Delete handler logic:**
   ```
   1. Get project from DB (scoped to user)
   2. If fly_machine_id exists:
      a. Try to destroy Fly Machine
      b. Log error if fails, but continue
   3. Delete project from DB
   4. Return 204
   ```

4. **Error responses:**
   ```go
   func writeError(w http.ResponseWriter, status int, message string) {
       w.Header().Set("Content-Type", "application/json")
       w.WriteHeader(status)
       json.NewEncoder(w).Encode(map[string]string{"error": message})
   }
   ```

---

### 2. Database Client Methods

Complete the methods stubbed in Phase 2a in `backend/db/client.go`:

```go
func (c *Client) ListProjects(ctx context.Context, userID string) ([]Project, error) {
    rows, err := c.pool.Query(ctx, `
        SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
               status, error_message, base_image, env_vars, last_accessed_at,
               created_at, updated_at
        FROM projects
        WHERE user_id = $1
        ORDER BY updated_at DESC
    `, userID)
    // ... scan rows
}

func (c *Client) GetProjectByUser(ctx context.Context, projectID, userID string) (*Project, error) {
    // Query with both project ID and user ID for authorization
    row := c.pool.QueryRow(ctx, `
        SELECT id, user_id, name, description, fly_machine_id, fly_volume_id,
               status, error_message, base_image, env_vars, last_accessed_at,
               created_at, updated_at
        FROM projects
        WHERE id = $1 AND user_id = $2
    `, projectID, userID)
    // ... scan row, return nil if not found
}

func (c *Client) CreateProject(ctx context.Context, project *Project) error {
    return c.pool.QueryRow(ctx, `
        INSERT INTO projects (user_id, name, description, base_image)
        VALUES ($1, $2, $3, $4)
        RETURNING id, created_at, updated_at
    `, project.UserID, project.Name, project.Description, project.BaseImage).
        Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)
}

func (c *Client) UpdateProject(ctx context.Context, projectID, userID string, name, description *string) (*Project, error) {
    // Use COALESCE to only update non-nil fields
}

func (c *Client) DeleteProject(ctx context.Context, projectID, userID string) error {
    result, err := c.pool.Exec(ctx, `
        DELETE FROM projects WHERE id = $1 AND user_id = $2
    `, projectID, userID)
    if result.RowsAffected() == 0 {
        return ErrNotFound
    }
    return err
}

func (c *Client) UpdateProjectStatus(ctx context.Context, projectID, status string, errorMsg *string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE projects SET status = $1, error_message = $2 WHERE id = $3
    `, status, errorMsg, projectID)
    return err
}

func (c *Client) UpdateProjectMachine(ctx context.Context, projectID, machineID string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE projects SET fly_machine_id = $1 WHERE id = $2
    `, machineID, projectID)
    return err
}

func (c *Client) UpdateProjectLastAccessed(ctx context.Context, projectID string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE projects SET last_accessed_at = now() WHERE id = $1
    `, projectID)
    return err
}
```

---

### 3. Update Terminal Handler

Modify `backend/handlers/terminal.go` to work with projects instead of raw machine IDs:

**Changes:**
1. Accept project ID instead of machine ID
2. Lookup project in database
3. Verify user owns project
4. Get Fly machine details from project
5. Update project's last_accessed_at on activity

```go
type TerminalHandler struct {
    sshClient *ssh.Client
    fly       *fly.Client
    db        *db.Client
}

func NewTerminalHandler(sshClient *ssh.Client, fly *fly.Client, db *db.Client) *TerminalHandler {
    return &TerminalHandler{
        sshClient: sshClient,
        fly:       fly,
        db:        db,
    }
}

func (h *TerminalHandler) HandleTerminal(w http.ResponseWriter, r *http.Request) {
    projectID := chi.URLParam(r, "id")
    userID := middleware.GetUserID(r.Context())

    // Get project (verifies ownership)
    project, err := h.db.GetProjectByUser(r.Context(), projectID, userID)
    if err != nil || project == nil {
        http.Error(w, "Project not found", http.StatusNotFound)
        return
    }

    if project.Status != "running" {
        http.Error(w, "Project is not running", http.StatusBadRequest)
        return
    }

    if project.FlyMachineID == nil {
        http.Error(w, "Project has no VM", http.StatusBadRequest)
        return
    }

    // Get machine details from Fly
    machine, err := h.fly.GetMachine(*project.FlyMachineID)
    if err != nil {
        http.Error(w, "Failed to get machine info", http.StatusInternalServerError)
        return
    }

    // Rest of terminal logic (SSH connection, etc.)
    // Update last_accessed_at on activity
}
```

---

### 4. Update Main Server

Update `backend/main.go`:

```go
func main() {
    // ... existing setup ...

    // Initialize database client
    dbClient, err := db.NewClient(requireEnv("DATABASE_URL"))
    if err != nil {
        log.Fatalf("Failed to connect to database: %v", err)
    }
    defer dbClient.Close()

    // Initialize auth middleware
    authMiddleware := middleware.NewAuthMiddleware(requireEnv("SUPABASE_JWT_SECRET"))

    // Initialize handlers
    projectHandler := handlers.NewProjectHandler(dbClient, flyClient, baseImage)
    terminalHandler := handlers.NewTerminalHandler(sshClient, flyClient, dbClient)

    r := chi.NewRouter()
    // ... middleware setup ...

    // Public routes
    r.Get("/health", healthHandler)

    // Protected routes
    r.Group(func(r chi.Router) {
        r.Use(authMiddleware.Authenticate)

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

    // Deprecate old machine routes (or remove entirely)
    // r.Route("/machines", ...) // REMOVED
}
```

---

### 5. Idle Timeout & Cleanup

**Idle timeout:**
- Move idle timeout logic from MachineHandler to a background goroutine
- Check all running projects periodically
- Stop machines that haven't been accessed in X minutes

```go
func (h *ProjectHandler) StartIdleChecker(interval, timeout time.Duration) {
    ticker := time.NewTicker(interval)
    go func() {
        for range ticker.C {
            h.checkIdleProjects(timeout)
        }
    }()
}

func (h *ProjectHandler) checkIdleProjects(timeout time.Duration) {
    ctx := context.Background()

    // Query projects that are running and idle
    projects, err := h.db.GetIdleRunningProjects(ctx, timeout)
    if err != nil {
        log.Printf("Error checking idle projects: %v", err)
        return
    }

    for _, p := range projects {
        log.Printf("Stopping idle project: %s", p.ID)
        if p.FlyMachineID != nil {
            h.fly.StopMachine(*p.FlyMachineID)
        }
        h.db.UpdateProjectStatus(ctx, p.ID, "stopped", nil)
    }
}
```

Add database method:
```go
func (c *Client) GetIdleRunningProjects(ctx context.Context, timeout time.Duration) ([]Project, error) {
    rows, err := c.pool.Query(ctx, `
        SELECT id, fly_machine_id
        FROM projects
        WHERE status = 'running'
          AND last_accessed_at < now() - $1::interval
    `, timeout)
    // ...
}
```

---

## File Structure After Phase 2b

```
backend/
├── main.go                 # Updated routing
├── go.mod
├── go.sum
├── fly/
│   └── client.go
├── ssh/
│   └── client.go
├── handlers/
│   ├── projects.go         # NEW - Project CRUD
│   ├── terminal.go         # UPDATED - Project-based
│   └── machines.go         # DEPRECATED/REMOVED
├── middleware/
│   └── auth.go
└── db/
    └── client.go           # UPDATED - All methods implemented
```

---

## Testing Plan

### API Tests with curl

```bash
# Set token variable
TOKEN="your-jwt-token"
API="http://localhost:8080"

# List projects (should be empty initially)
curl -s "$API/projects" -H "Authorization: Bearer $TOKEN" | jq

# Create project
curl -s -X POST "$API/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-project", "description": "My first project"}' | jq

# Get project (use ID from create response)
PROJECT_ID="..."
curl -s "$API/projects/$PROJECT_ID" -H "Authorization: Bearer $TOKEN" | jq

# Start project
curl -s -X POST "$API/projects/$PROJECT_ID/start" \
  -H "Authorization: Bearer $TOKEN" | jq

# Check status (should be "running")
curl -s "$API/projects/$PROJECT_ID" -H "Authorization: Bearer $TOKEN" | jq '.status'

# Test terminal (use wscat or browser)
# wscat -c "ws://localhost:8080/projects/$PROJECT_ID/terminal" -H "Authorization: Bearer $TOKEN"

# Stop project
curl -s -X POST "$API/projects/$PROJECT_ID/stop" \
  -H "Authorization: Bearer $TOKEN" | jq

# Update project
curl -s -X PATCH "$API/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "renamed-project"}' | jq

# Delete project
curl -s -X DELETE "$API/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
# Should return 204

# Verify deletion
curl -s "$API/projects/$PROJECT_ID" -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
# Should return 404
```

### Authorization Tests

```bash
# Create second user in Supabase, get their token
OTHER_TOKEN="..."

# Try to access first user's project with second user's token
curl -s "$API/projects/$PROJECT_ID" -H "Authorization: Bearer $OTHER_TOKEN" -w "%{http_code}"
# Should return 404 (not 403, to prevent enumeration)
```

### Edge Cases to Test

1. Create project with empty name → 400
2. Create project with very long name (>100 chars) → 400
3. Start already running project → 200 (idempotent)
4. Stop already stopped project → 200 (idempotent)
5. Delete project with running VM → 204 (VM destroyed)
6. Terminal on stopped project → 400

---

## Definition of Done

Phase 2b is complete when:

1. [ ] All CRUD endpoints work correctly
2. [ ] Users can only access their own projects
3. [ ] Start creates VM on first use, starts existing VM otherwise
4. [ ] Stop correctly stops the VM
5. [ ] Delete destroys VM and removes DB row
6. [ ] Terminal works via project endpoint
7. [ ] Idle timeout stops unused VMs
8. [ ] Old /machines routes removed

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Orphaned VMs | Idle checker + startup reconciliation |
| Race conditions on start | Use database status as lock, check before operations |
| VM creation fails | Set status to "error", allow retry |
| Slow VM startup | Return immediately with "starting" status, poll from frontend |

---

## Notes

- Consider adding a "starting" response that lets frontend poll for status
- Machine names should include project ID for debugging: `aether-{projectID[:8]}`
- Log all VM operations for debugging
- The terminal handler no longer needs MachineHandler - it uses the Fly client directly
