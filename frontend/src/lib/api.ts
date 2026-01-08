import { supabase } from "./supabase"

const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error("Missing VITE_API_URL environment variable")
}

export interface Project {
  id: string
  name: string
  description?: string
  status: "stopped" | "starting" | "running" | "stopping" | "error"
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
}
