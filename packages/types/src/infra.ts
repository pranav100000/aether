// =============================================================================
// Infrastructure Service Types - Shared across web, API, and workspace-service
// =============================================================================

/** Available infrastructure service types */
export type InfraServiceType = "supabase" | "redis" | "postgres" | "mongodb" | "mysql";

/** Infrastructure service status */
export type InfraServiceStatus =
  | "provisioning"
  | "ready"
  | "stopping"
  | "stopped"
  | "error"
  | "deleted";

/** Port configuration for multi-port services */
export interface InfraPorts {
  [name: string]: number;
}

/** Connection details returned when provisioning a service */
export interface ConnectionDetails {
  /** Internal hostname for the service */
  host: string;
  /** Primary port (for single-port services) */
  port?: number;
  /** Named ports (for multi-port services like Supabase) */
  ports?: InfraPorts;
  /** Database/service username */
  username?: string;
  /** Database/service password */
  password?: string;
  /** Formatted connection URL (e.g., postgresql://...) */
  url?: string;
  /** Environment variables to set for using this service */
  env?: Record<string, string>;
}

/** Infrastructure service record */
export interface InfraService {
  /** Unique service ID */
  id: string;
  /** Project this service belongs to */
  projectId: string;
  /** Type of service */
  serviceType: InfraServiceType;
  /** Optional user-friendly name */
  name?: string;
  /** Current status */
  status: InfraServiceStatus;
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Connection details (only present when status is 'ready') */
  connection?: ConnectionDetails;
  /** Service-specific configuration */
  config?: Record<string, unknown>;
  /** When the service was created */
  createdAt: string;
  /** When the service was last updated */
  updatedAt: string;
}

/** Request to provision a new infrastructure service */
export interface ProvisionInfraRequest {
  /** Type of service to provision */
  serviceType: InfraServiceType;
  /** Optional user-friendly name */
  name?: string;
  /** Optional service-specific configuration */
  config?: Record<string, unknown>;
}

/** Response from provisioning an infrastructure service */
export interface ProvisionInfraResponse {
  /** The created service record */
  service: InfraService;
}

/** Response from listing infrastructure services */
export interface ListInfraResponse {
  /** List of services for the project */
  services: InfraService[];
}

/** Service definition metadata (for UI display) */
export interface InfraServiceDefinition {
  /** Service type identifier */
  type: InfraServiceType;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Whether this service type is available */
  available: boolean;
}

/** Available service definitions */
export const INFRA_SERVICE_DEFINITIONS: InfraServiceDefinition[] = [
  {
    type: "supabase",
    displayName: "Supabase",
    description: "Full Supabase stack: PostgreSQL + PostgREST + GoTrue auth + Realtime + Studio",
    available: true,
  },
  {
    type: "redis",
    displayName: "Redis",
    description: "In-memory data store for caching and message queues",
    available: false, // Not yet implemented
  },
  {
    type: "postgres",
    displayName: "PostgreSQL",
    description: "Standalone PostgreSQL database",
    available: false, // Not yet implemented
  },
  {
    type: "mongodb",
    displayName: "MongoDB",
    description: "Document database",
    available: false, // Not yet implemented
  },
  {
    type: "mysql",
    displayName: "MySQL",
    description: "MySQL database",
    available: false, // Not yet implemented
  },
] as const;

/** Get service definition by type */
export function getServiceDefinition(type: InfraServiceType): InfraServiceDefinition | undefined {
  return INFRA_SERVICE_DEFINITIONS.find((d) => d.type === type);
}

/** Get available service types */
export function getAvailableServiceTypes(): InfraServiceType[] {
  return INFRA_SERVICE_DEFINITIONS.filter((d) => d.available).map((d) => d.type);
}
