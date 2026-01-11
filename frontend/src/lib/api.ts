import { supabase } from "./supabase"

const API_URL = import.meta.env.VITE_API_URL
const LOCAL_AGENT_URL = import.meta.env.VITE_LOCAL_AGENT_URL

if (!API_URL) {
  throw new Error("Missing VITE_API_URL environment variable")
}

export interface HardwareConfig {
  cpu_kind: "shared" | "performance"
  cpus: number
  memory_mb: number
  volume_size_gb: number
  gpu_kind?: "a10" | "l40s" | "a100-40gb" | "a100-80gb" | null
}

export interface HardwarePreset {
  id: string
  name: string
  description: string
  config: HardwareConfig
}

export const HARDWARE_PRESETS: HardwarePreset[] = [
  {
    id: "small",
    name: "Small",
    description: "1 shared CPU, 1GB RAM, 5GB storage",
    config: { cpu_kind: "shared", cpus: 1, memory_mb: 1024, volume_size_gb: 5 },
  },
  {
    id: "medium",
    name: "Medium",
    description: "2 shared CPUs, 2GB RAM, 10GB storage",
    config: { cpu_kind: "shared", cpus: 2, memory_mb: 2048, volume_size_gb: 10 },
  },
  {
    id: "large",
    name: "Large",
    description: "4 shared CPUs, 4GB RAM, 20GB storage",
    config: { cpu_kind: "shared", cpus: 4, memory_mb: 4096, volume_size_gb: 20 },
  },
  {
    id: "performance",
    name: "Performance",
    description: "2 performance CPUs, 4GB RAM, 20GB storage",
    config: { cpu_kind: "performance", cpus: 2, memory_mb: 4096, volume_size_gb: 20 },
  },
]

// Idle timeout options
export const IDLE_TIMEOUT_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 0, label: "Never (manual stop only)" },
] as const

export type IdleTimeoutMinutes = 0 | 5 | 10 | 30 | 60 | null

// User Settings types
export interface UserSettings {
  default_hardware: HardwareConfig
  default_idle_timeout_minutes: IdleTimeoutMinutes
}

export interface UpdateUserSettingsInput {
  default_hardware?: HardwareConfig
  default_idle_timeout_minutes?: IdleTimeoutMinutes
}

export interface Project {
  id: string
  name: string
  description?: string
  status: "stopped" | "starting" | "running" | "stopping" | "error"
  hardware: HardwareConfig
  idle_timeout_minutes?: IdleTimeoutMinutes
  fly_machine_id?: string
  private_ip?: string
  vm_url?: string
  preview_token?: string
  error_message?: string
  last_accessed_at?: string
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  description?: string
  hardware?: {
    preset?: string
    cpu_kind?: string
    cpus?: number
    memory_mb?: number
    volume_size_gb?: number
    gpu_kind?: string | null
  }
  idle_timeout_minutes?: IdleTimeoutMinutes
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

// File system types
export interface FileEntry {
  name: string
  type: "file" | "directory"
  size?: number
  modified: string
}

export interface DirListing {
  path: string
  entries: FileEntry[]
}

export interface FileInfo {
  path: string
  content?: string
  size: number
  modified: string
}

export interface FileTree {
  paths: string[]
  directories: string[]
}

// API Keys types
export interface ConnectedProvider {
  provider: string
  connected: boolean
  added_at?: string
}

export interface ListProvidersResponse {
  providers: ConnectedProvider[]
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error("Not authenticated")
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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
      error: `Request failed with status ${response.status}`,
    }))
    throw new Error(error.error)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

// Direct VM request - calls workspace-service on the VM
async function vmRequest<T>(
  vmUrl: string,
  machineId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${vmUrl}${path}`, {
    ...options,
    headers: {
      ...headers,
      "fly-force-instance-id": machineId,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      error: `Request failed with status ${response.status}`,
    }))
    throw new Error(error.error)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export const api = {
  async listProjects(): Promise<{ projects: Project[] }> {
    return apiRequest("/projects")
  },

  async getProject(id: string): Promise<Project> {
    return apiRequest(`/projects/${id}`)
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    return apiRequest("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
    return apiRequest(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  },

  async deleteProject(id: string): Promise<void> {
    return apiRequest(`/projects/${id}`, {
      method: "DELETE",
    })
  },

  async startProject(id: string): Promise<StartResponse> {
    return apiRequest(`/projects/${id}/start`, {
      method: "POST",
    })
  },

  async stopProject(id: string): Promise<{ status: string }> {
    return apiRequest(`/projects/${id}/stop`, {
      method: "POST",
    })
  },

  getTerminalUrl(projectId: string): string {
    const wsUrl = API_URL.replace("http", "ws")
    return `${wsUrl}/projects/${projectId}/terminal`
  },

  getAgentUrl(projectId: string, agent: "claude" | "codex" | "opencode" | "codebuff"): string {
    // Local dev mode: direct WebSocket to local agent service
    if (LOCAL_AGENT_URL) {
      return `${LOCAL_AGENT_URL}/agent/${agent}`
    }

    // Production mode: WebSocket to Go backend
    const wsUrl = API_URL.replace("http", "ws")
    return `${wsUrl}/projects/${projectId}/agent/${agent}`
  },

  // File system operations - call VM directly via workspace-service
  async listFiles(vmUrl: string, machineId: string, path: string = "/"): Promise<DirListing> {
    return vmRequest(`${vmUrl}`, machineId, `/files?path=${encodeURIComponent(path)}`)
  },

  async listFilesTree(vmUrl: string, machineId: string): Promise<FileTree> {
    return vmRequest(`${vmUrl}`, machineId, `/files/tree`)
  },

  async readFile(vmUrl: string, machineId: string, path: string): Promise<FileInfo> {
    return vmRequest(`${vmUrl}`, machineId, `/files?path=${encodeURIComponent(path)}`)
  },

  async writeFile(vmUrl: string, machineId: string, path: string, content: string): Promise<FileInfo> {
    return vmRequest(`${vmUrl}`, machineId, `/files?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    })
  },

  async mkdir(vmUrl: string, machineId: string, path: string): Promise<{ path: string }> {
    return vmRequest(`${vmUrl}`, machineId, `/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    })
  },

  async deleteFile(vmUrl: string, machineId: string, path: string): Promise<void> {
    return vmRequest(`${vmUrl}`, machineId, `/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    })
  },

  async renameFile(vmUrl: string, machineId: string, oldPath: string, newPath: string): Promise<{ path: string }> {
    return vmRequest(`${vmUrl}`, machineId, `/files/rename`, {
      method: "POST",
      body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
    })
  },

  // API Keys operations
  async getApiKeys(): Promise<ListProvidersResponse> {
    return apiRequest("/user/api-keys")
  },

  async addApiKey(provider: string, apiKey: string): Promise<ConnectedProvider> {
    return apiRequest("/user/api-keys", {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    })
  },

  async removeApiKey(provider: string): Promise<void> {
    return apiRequest(`/user/api-keys/${provider}`, {
      method: "DELETE",
    })
  },

  // User Settings operations
  async getUserSettings(): Promise<UserSettings> {
    return apiRequest("/user/settings")
  },

  async updateUserSettings(input: UpdateUserSettingsInput): Promise<UserSettings> {
    return apiRequest("/user/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  // Port operations
  async killPort(projectId: string, port: number): Promise<void> {
    return apiRequest(`/projects/${projectId}/ports/${port}/kill`, {
      method: "POST",
    })
  },
}
