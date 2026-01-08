# Phase 2d PRD: Frontend Features & Integration

**Project:** aether
**Phase:** 2d of 2a-2d
**Depends on:** Phase 2b (Backend API), Phase 2c (Frontend Foundation)
**Goal:** Complete the frontend with project management and terminal integration

---

## Overview

Phase 2d completes the MVP by connecting the frontend to the backend API and implementing the full user workflow. By the end of this phase:

1. Users can create, view, and delete projects
2. Users can start and stop project VMs
3. Users can connect to a working terminal in their browser
4. All states (loading, error, running, stopped) are handled gracefully
5. The app is deployed and accessible via URL

This is the final phase of Phase 2.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Sign up → terminal | <60 seconds for new user |
| Project creation | <5 seconds |
| Return to existing project | <3 seconds to terminal |
| Terminal responsiveness | <100ms input latency |
| Error recovery | Clear messages, retry options |
| Mobile usability | Terminal usable on tablet/phone |

---

## Prerequisites

- Phase 2b complete (Backend API working)
- Phase 2c complete (Frontend with auth)
- Backend running and accessible

---

## Technical Requirements

### 1. API Client

`frontend/src/lib/api.ts`:

```typescript
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('Missing VITE_API_URL environment variable')
}

// Types
export interface Project {
  id: string
  name: string
  description?: string
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  fly_machine_id?: string
  error_message?: string
  last_accessed_at?: string
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  description?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
}

export interface StartResponse {
  status: string
  terminal_url: string
}

export interface ApiError {
  error: string
}

// Helper to get auth header
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }

  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

// Helper for API requests
async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      error: `Request failed with status ${response.status}`
    }))
    throw new Error(error.error)
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

// API methods
export const api = {
  // Projects
  async listProjects(): Promise<{ projects: Project[] }> {
    return apiRequest('/projects')
  },

  async getProject(id: string): Promise<Project> {
    return apiRequest(`/projects/${id}`)
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    return apiRequest('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
    return apiRequest(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },

  async deleteProject(id: string): Promise<void> {
    return apiRequest(`/projects/${id}`, {
      method: 'DELETE',
    })
  },

  async startProject(id: string): Promise<StartResponse> {
    return apiRequest(`/projects/${id}/start`, {
      method: 'POST',
    })
  },

  async stopProject(id: string): Promise<{ status: string }> {
    return apiRequest(`/projects/${id}/stop`, {
      method: 'POST',
    })
  },

  // Terminal WebSocket URL
  getTerminalUrl(projectId: string): string {
    const wsUrl = API_URL.replace('http', 'ws')
    return `${wsUrl}/projects/${projectId}/terminal`
  },
}
```

---

### 2. Projects Hook

`frontend/src/hooks/useProjects.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { api, Project, CreateProjectInput } from '../lib/api'

interface UseProjectsReturn {
  projects: Project[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createProject: (input: CreateProjectInput) => Promise<Project>
  deleteProject: (id: string) => Promise<void>
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const { projects } = await api.listProjects()
      setProjects(projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createProject = useCallback(async (input: CreateProjectInput) => {
    const project = await api.createProject(input)
    setProjects(prev => [project, ...prev])
    return project
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }, [])

  return {
    projects,
    loading,
    error,
    refresh,
    createProject,
    deleteProject,
  }
}
```

`frontend/src/hooks/useProject.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { api, Project } from '../lib/api'

interface UseProjectReturn {
  project: Project | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function useProject(projectId: string): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await api.getProject(projectId)
      setProject(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const start = useCallback(async () => {
    setProject(prev => prev ? { ...prev, status: 'starting' } : null)
    try {
      await api.startProject(projectId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start project')
      await refresh()
    }
  }, [projectId, refresh])

  const stop = useCallback(async () => {
    setProject(prev => prev ? { ...prev, status: 'stopping' } : null)
    try {
      await api.stopProject(projectId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop project')
      await refresh()
    }
  }, [projectId, refresh])

  return {
    project,
    loading,
    error,
    refresh,
    start,
    stop,
  }
}
```

---

### 3. Project Components

`frontend/src/components/projects/StatusBadge.tsx`:

```typescript
interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<string, { color: string; dot: string; label: string }> = {
    stopped: { color: 'bg-gray-700 text-gray-300', dot: 'bg-gray-500', label: 'Stopped' },
    starting: { color: 'bg-yellow-900/50 text-yellow-300', dot: 'bg-yellow-500 animate-pulse', label: 'Starting' },
    running: { color: 'bg-green-900/50 text-green-300', dot: 'bg-green-500', label: 'Running' },
    stopping: { color: 'bg-yellow-900/50 text-yellow-300', dot: 'bg-yellow-500 animate-pulse', label: 'Stopping' },
    error: { color: 'bg-red-900/50 text-red-300', dot: 'bg-red-500', label: 'Error' },
  }

  const { color, dot, label } = config[status] || config.stopped

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${color}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
```

`frontend/src/components/projects/ProjectCard.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Project } from '../../lib/api'
import { Button } from '../ui/Button'
import { StatusBadge } from './StatusBadge'

interface ProjectCardProps {
  project: Project
  onDelete: (id: string) => Promise<void>
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)

  const handleOpen = () => {
    navigate(`/projects/${project.id}`)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}"? This will destroy the VM and cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      await onDelete(project.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (date: string | undefined) => {
    if (!date) return 'Never'
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()

    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
    return `${Math.floor(diff / 86400000)} days ago`
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-white">{project.name}</h3>
          {project.description && (
            <p className="text-sm text-gray-400 mt-1">{project.description}</p>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      <p className="text-xs text-gray-500 mb-4">
        Last accessed: {formatDate(project.last_accessed_at)}
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleOpen}>
          Open
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={handleDelete}
          loading={deleting}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
```

`frontend/src/components/projects/CreateProjectModal.tsx`:

```typescript
import { useState, FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (name: string, description?: string) => Promise<void>
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await onCreate(name, description || undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-4">New Project</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <Input
            id="name"
            label="Project name"
            placeholder="my-project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <Input
            id="description"
            label="Description (optional)"
            placeholder="What are you building?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create project
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

---

### 4. Terminal Component

`frontend/src/components/workspace/Terminal.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import 'xterm/css/xterm.css'

interface TerminalProps {
  projectId: string
  onDisconnect?: () => void
}

interface WSMessage {
  type: 'input' | 'output' | 'resize' | 'error'
  data?: string
  cols?: number
  rows?: number
}

export function Terminal({ projectId, onDisconnect }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Initialize terminal
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#555555',
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // Try to use WebGL renderer for better performance
    try {
      const webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not supported, fall back to canvas
    }

    terminal.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle resize
    const handleResize = () => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const message: WSMessage = {
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }
        wsRef.current.send(JSON.stringify(message))
      }
    }

    window.addEventListener('resize', handleResize)

    // Connect to WebSocket
    const connect = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error('Not authenticated')
        }

        const wsUrl = api.getTerminalUrl(projectId)
        const ws = new WebSocket(wsUrl, ['bearer', session.access_token])

        ws.onopen = () => {
          setStatus('connected')
          setError(null)
          // Send initial size
          const message: WSMessage = {
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          }
          ws.send(JSON.stringify(message))
        }

        ws.onmessage = (event) => {
          try {
            const message: WSMessage = JSON.parse(event.data)
            if (message.type === 'output' && message.data) {
              terminal.write(message.data)
            } else if (message.type === 'error' && message.data) {
              terminal.write(`\r\n\x1b[31mError: ${message.data}\x1b[0m\r\n`)
              setError(message.data)
            }
          } catch {
            // Not JSON, write raw data
            terminal.write(event.data)
          }
        }

        ws.onerror = () => {
          setStatus('error')
          setError('Connection error')
        }

        ws.onclose = () => {
          setStatus('disconnected')
          onDisconnect?.()
        }

        wsRef.current = ws

        // Handle terminal input
        terminal.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            const message: WSMessage = { type: 'input', data }
            ws.send(JSON.stringify(message))
          }
        })

      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to connect')
      }
    }

    connect()

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      wsRef.current?.close()
      terminal.dispose()
    }
  }, [projectId, onDisconnect])

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-b border-gray-800 text-xs">
        <span className="text-gray-400">Terminal</span>
        <span className={`flex items-center gap-1.5 ${
          status === 'connected' ? 'text-green-400' :
          status === 'connecting' ? 'text-yellow-400' :
          'text-red-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            status === 'connected' ? 'bg-green-500' :
            status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`} />
          {status === 'connecting' && 'Connecting...'}
          {status === 'connected' && 'Connected'}
          {status === 'disconnected' && 'Disconnected'}
          {status === 'error' && (error || 'Error')}
        </span>
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 p-2" />
    </div>
  )
}
```

---

### 5. Pages

`frontend/src/pages/Projects.tsx`:

```typescript
import { useState } from 'react'
import { Layout } from '../components/layout/Layout'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ProjectCard } from '../components/projects/ProjectCard'
import { CreateProjectModal } from '../components/projects/CreateProjectModal'
import { useProjects } from '../hooks/useProjects'

export function Projects() {
  const { projects, loading, error, createProject, deleteProject, refresh } = useProjects()
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = async (name: string, description?: string) => {
    await createProject({ name, description })
  }

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Projects</h1>
          <p className="text-gray-400 mt-1">
            Create and manage your cloud development environments.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          New Project
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{error}</p>
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 border border-gray-800 rounded-lg">
          <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
          <p className="text-gray-400 mb-4">Create your first project to get started.</p>
          <Button onClick={() => setShowCreate(true)}>
            Create project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={deleteProject}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </Layout>
  )
}
```

`frontend/src/pages/Workspace.tsx`:

```typescript
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { StatusBadge } from '../components/projects/StatusBadge'
import { Terminal } from '../components/workspace/Terminal'

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, loading, error, start, stop, refresh } = useProject(id!)
  const [starting, setStarting] = useState(false)

  const handleStart = async () => {
    setStarting(true)
    try {
      await start()
    } finally {
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Project not found'}</p>
          <Button variant="secondary" onClick={() => navigate('/projects')}>
            Back to projects
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Link
            to="/projects"
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-white font-medium">{project.name}</span>
          <StatusBadge status={project.status} />
        </div>

        <div className="flex items-center gap-2">
          {project.status === 'running' && (
            <Button size="sm" variant="secondary" onClick={stop}>
              Stop
            </Button>
          )}
          {project.status === 'stopped' && (
            <Button size="sm" onClick={handleStart} loading={starting}>
              Start
            </Button>
          )}
          {project.status === 'error' && (
            <Button size="sm" onClick={handleStart} loading={starting}>
              Retry
            </Button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {project.status === 'running' ? (
          <Terminal projectId={project.id} onDisconnect={refresh} />
        ) : project.status === 'starting' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-gray-400">Starting your environment...</p>
              <p className="text-gray-500 text-sm mt-2">This may take a few seconds.</p>
            </div>
          </div>
        ) : project.status === 'stopping' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-gray-400">Stopping your environment...</p>
            </div>
          </div>
        ) : project.status === 'error' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-red-400 text-5xl mb-4">!</div>
              <p className="text-red-400 mb-2">Failed to start environment</p>
              {project.error_message && (
                <p className="text-gray-500 text-sm mb-4">{project.error_message}</p>
              )}
              <Button onClick={handleStart} loading={starting}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-400 mb-4">Your environment is stopped.</p>
              <Button onClick={handleStart} loading={starting}>
                Start environment
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
```

---

### 6. Update App Router

`frontend/src/App.tsx`:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { AuthGuard } from './components/auth/AuthGuard'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Projects } from './pages/Projects'
import { Workspace } from './pages/Workspace'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected routes */}
          <Route
            path="/projects"
            element={
              <AuthGuard>
                <Projects />
              </AuthGuard>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <AuthGuard>
                <Workspace />
              </AuthGuard>
            }
          />

          {/* Redirect root to projects */}
          <Route path="/" element={<Navigate to="/projects" replace />} />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
```

---

### 7. WebSocket Auth Protocol

The terminal WebSocket needs authentication. Update the backend to support subprotocol-based auth:

**Backend change** (`backend/handlers/terminal.go`):

```go
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        return true // TODO: restrict in production
    },
    Subprotocols: []string{"bearer"},
}

func (h *TerminalHandler) HandleTerminal(w http.ResponseWriter, r *http.Request) {
    // Check for token in subprotocol
    // Client sends: Sec-WebSocket-Protocol: bearer, <token>
    // Server responds: Sec-WebSocket-Protocol: bearer

    protocols := websocket.Subprotocols(r)
    var token string
    for i, p := range protocols {
        if p == "bearer" && i+1 < len(protocols) {
            token = protocols[i+1]
            break
        }
    }

    if token == "" {
        // Fall back to Authorization header (for testing with wscat)
        auth := r.Header.Get("Authorization")
        if strings.HasPrefix(auth, "Bearer ") {
            token = strings.TrimPrefix(auth, "Bearer ")
        }
    }

    if token == "" {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }

    // Validate token (same as auth middleware)
    userID, err := h.validateToken(token)
    if err != nil {
        http.Error(w, "Invalid token", http.StatusUnauthorized)
        return
    }

    // Rest of handler uses userID for project lookup...
}
```

---

### 8. File Structure After Phase 2d

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env
├── .env.example
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── vite-env.d.ts
    │
    ├── lib/
    │   ├── supabase.ts
    │   └── api.ts
    │
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useProjects.ts
    │   └── useProject.ts
    │
    ├── components/
    │   ├── ui/
    │   │   ├── Button.tsx
    │   │   ├── Input.tsx
    │   │   └── Spinner.tsx
    │   ├── auth/
    │   │   ├── AuthForm.tsx
    │   │   └── AuthGuard.tsx
    │   ├── layout/
    │   │   └── Layout.tsx
    │   ├── projects/
    │   │   ├── ProjectCard.tsx
    │   │   ├── CreateProjectModal.tsx
    │   │   └── StatusBadge.tsx
    │   └── workspace/
    │       └── Terminal.tsx
    │
    └── pages/
        ├── Login.tsx
        ├── Signup.tsx
        ├── Projects.tsx
        └── Workspace.tsx
```

---

## Testing Plan

### End-to-End Flow

1. **Sign up:** Create new account
2. **Create project:** Click "New Project", enter name
3. **Open project:** Click "Open" on project card
4. **Start VM:** Click "Start environment"
5. **Wait:** See "Starting..." spinner
6. **Use terminal:** Type commands, verify output
7. **Stop VM:** Click "Stop" in header
8. **Return later:** Close tab, come back, project still there
9. **Delete project:** Click "Delete", confirm

### Edge Cases

1. **Slow network:** Terminal reconnection handling
2. **VM start timeout:** Error state with retry
3. **Token expiration:** Auto-refresh (handled by Supabase)
4. **Concurrent tabs:** Multiple terminals to same project
5. **Mobile:** Terminal usable with touch keyboard

### Browser Testing

- Chrome (primary)
- Firefox
- Safari
- Mobile Safari (iOS)
- Chrome Mobile (Android)

---

## Deployment

### Frontend Deployment (Vercel)

```bash
cd frontend
npm run build
# Deploy via Vercel CLI or GitHub integration
```

`frontend/vercel.json`:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

### Environment Variables in Vercel

Set these in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (production backend URL)

---

## Definition of Done

Phase 2d (and Phase 2 overall) is complete when:

1. [ ] User can sign up and log in
2. [ ] User can create projects with name
3. [ ] Project list shows all user's projects
4. [ ] User can open project and see workspace
5. [ ] User can start VM and get working terminal
6. [ ] Terminal input/output works correctly
7. [ ] User can stop running project
8. [ ] User can delete project
9. [ ] Error states show clear messages with retry options
10. [ ] App works on mobile devices
11. [ ] Frontend is deployed and accessible

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WebSocket auth complexity | Subprotocol approach, fallback to header |
| Terminal performance | WebGL addon, debounced resize |
| Token in WebSocket URL (security) | Use subprotocol, not query param |
| CORS issues | Configure backend, test early |

---

## Notes

- xterm.js CSS must be imported for proper rendering
- WebGL addon may not work in all browsers - falls back gracefully
- Terminal resize events should be debounced for performance
- Consider adding reconnection logic for terminal WebSocket
- Mobile keyboards may need special handling for terminal input
