// =============================================================================
// Project Types - Shared across web and API
// =============================================================================

import type { HardwareConfig, IdleTimeoutMinutes } from "./hardware";

/** Project status */
export type ProjectStatus = "stopped" | "starting" | "running" | "stopping" | "error";

/** Project entity */
export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  hardware: HardwareConfig;
  idle_timeout_minutes?: IdleTimeoutMinutes;
  fly_machine_id?: string;
  private_ip?: string;
  preview_token?: string;
  error_message?: string;
  last_accessed_at?: string;
  created_at: string;
  updated_at: string;
}

/** Input for creating a project */
export interface CreateProjectInput {
  name: string;
  description?: string;
  hardware?: {
    preset?: string;
    cpu_kind?: string;
    cpus?: number;
    memory_mb?: number;
    volume_size_gb?: number;
    gpu_kind?: string | null;
  };
  idle_timeout_minutes?: IdleTimeoutMinutes;
}

/** Input for updating a project */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

/** Response from starting a project */
export interface StartProjectResponse {
  status: string;
  terminal_url: string;
}

// =============================================================================
// File System Types
// =============================================================================

/** File or directory entry */
export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  modified: string;
}

/** Directory listing response */
export interface DirListing {
  path: string;
  entries: FileEntry[];
}

/** File info with content */
export interface FileInfo {
  path: string;
  content?: string;
  size: number;
  modified: string;
}

/** File tree response */
export interface FileTree {
  paths: string[];
  directories: string[];
}

// =============================================================================
// User Settings Types
// =============================================================================

/** User settings entity */
export interface UserSettings {
  default_hardware: HardwareConfig;
  default_idle_timeout_minutes: IdleTimeoutMinutes;
}

/** Input for updating user settings */
export interface UpdateUserSettingsInput {
  default_hardware?: HardwareConfig;
  default_idle_timeout_minutes?: IdleTimeoutMinutes;
}

// =============================================================================
// API Keys Types
// =============================================================================

/** Connected provider status */
export interface ConnectedProvider {
  provider: string;
  connected: boolean;
  added_at?: string;
}

/** List providers response */
export interface ListProvidersResponse {
  providers: ConnectedProvider[];
}

// =============================================================================
// API Response Types
// =============================================================================

/** Generic API error */
export interface ApiError {
  error: string;
}
