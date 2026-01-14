import { supabase } from "./supabase"

// Re-export types from shared package for backwards compatibility
export {
  type HardwareConfig,
  type HardwarePreset,
  type IdleTimeoutMinutes,
  HARDWARE_PRESETS,
  IDLE_TIMEOUT_OPTIONS,
  type Project,
  type CreateProjectInput,
  type UpdateProjectInput,
  type FileEntry,
  type DirListing,
  type FileInfo,
  type FileTree,
  type UserSettings,
  type UpdateUserSettingsInput,
  type ConnectedProvider,
  type ListProvidersResponse,
  type ApiError,
} from "@aether/types"

// Local type alias for backwards compatibility
export type { StartProjectResponse as StartResponse } from "@aether/types"

import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  DirListing,
  FileTree,
  FileInfo,
  UserSettings,
  UpdateUserSettingsInput,
  ConnectedProvider,
  ListProvidersResponse,
  ApiError,
  StartProjectResponse as StartResponse,
} from "@aether/types"

const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error("Missing VITE_API_URL environment variable")
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
    // Production mode: WebSocket to Go backend
    const wsUrl = API_URL.replace("http", "ws")
    return `${wsUrl}/projects/${projectId}/agent/${agent}`
  },

  getWorkspaceUrl(projectId: string): string {
    // Unified workspace WebSocket (terminal + agent + files + ports)
    const wsUrl = API_URL.replace("http", "ws")
    return `${wsUrl}/projects/${projectId}/workspace`
  },

  // File system operations
  async listFiles(projectId: string, path: string = "/"): Promise<DirListing> {
    return apiRequest(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`)
  },

  async listFilesTree(projectId: string): Promise<FileTree> {
    return apiRequest(`/projects/${projectId}/files/tree`)
  },

  async readFile(projectId: string, path: string): Promise<FileInfo> {
    return apiRequest(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`)
  },

  async writeFile(projectId: string, path: string, content: string): Promise<FileInfo> {
    return apiRequest(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    })
  },

  async mkdir(projectId: string, path: string): Promise<{ path: string }> {
    return apiRequest(`/projects/${projectId}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    })
  },

  async deleteFile(projectId: string, path: string): Promise<void> {
    return apiRequest(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    })
  },

  async renameFile(projectId: string, oldPath: string, newPath: string): Promise<{ path: string }> {
    return apiRequest(`/projects/${projectId}/files/rename`, {
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
