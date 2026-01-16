import { getCustomToolDefinition } from "@codebuff/sdk";
import { z } from "zod";

// Infrastructure service types that can be provisioned
const InfraServiceType = z.enum(["supabase", "redis"]);

/**
 * Custom tool for provisioning infrastructure services.
 * Called by Codebuff when the agent needs a database, cache, or other service.
 */
export const provisionInfraTool = getCustomToolDefinition({
  toolName: "provision_infra",
  description: `Provision an infrastructure service (database, cache, etc.) for the current project.
Returns connection details including host, port, credentials, and environment variables.
Use this when you need to set up a database or other backend service for the project.

Available service types:
- supabase: Full Supabase stack with PostgreSQL database, authentication, and realtime features
- redis: In-memory data store for caching and message queues

The connection details will include:
- host: The hostname to connect to
- port: The port number
- username/password: Credentials if applicable
- url: A formatted connection string (e.g., postgresql://...)
- env: Environment variables to set in the project`,
  inputSchema: z.object({
    service_type: InfraServiceType.describe("Type of infrastructure service to provision"),
    name: z.string().optional().describe("Optional name for the service"),
  }),
  exampleInputs: [
    { service_type: "supabase" },
    { service_type: "redis" },
    { service_type: "supabase", name: "main-db" },
  ],
  execute: async (params) => {
    const { service_type, name } = params as { service_type: string; name?: string };
    const projectId = Bun.env.PROJECT_ID;
    if (!projectId) {
      throw new Error("PROJECT_ID environment variable not set");
    }

    const apiUrl = Bun.env.AETHER_API_URL || "http://api.internal:8080";

    console.log(`[provision_infra] Provisioning ${service_type} for project ${projectId}`);

    const response = await fetch(`${apiUrl}/internal/projects/${projectId}/infra`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_type, name }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[provision_infra] Failed: ${error}`);
      throw new Error(`Failed to provision ${service_type}: ${error}`);
    }

    const result = await response.json();
    console.log(`[provision_infra] Success:`, JSON.stringify(result, null, 2));

    return [{ type: "json" as const, value: result }];
  },
});

/**
 * Custom tool for listing infrastructure services in the project.
 */
export const listInfraTool = getCustomToolDefinition({
  toolName: "list_infra",
  description: `List all infrastructure services provisioned for the current project.
Returns an array of services with their status and connection details.`,
  inputSchema: z.object({}),
  exampleInputs: [{}],
  execute: async () => {
    const projectId = Bun.env.PROJECT_ID;
    if (!projectId) {
      throw new Error("PROJECT_ID environment variable not set");
    }

    const apiUrl = Bun.env.AETHER_API_URL || "http://api.internal:8080";

    console.log(`[list_infra] Listing services for project ${projectId}`);

    const response = await fetch(`${apiUrl}/internal/projects/${projectId}/infra`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[list_infra] Failed: ${error}`);
      throw new Error(`Failed to list infrastructure services: ${error}`);
    }

    const result = await response.json();
    console.log(`[list_infra] Found ${result.services?.length || 0} services`);

    return [{ type: "json" as const, value: result }];
  },
});

/**
 * Custom tool for getting available infrastructure service types.
 */
export const getInfraTypesTool = getCustomToolDefinition({
  toolName: "get_infra_types",
  description: `Get available infrastructure service types that can be provisioned.
Returns a list of service types with their descriptions.`,
  inputSchema: z.object({}),
  exampleInputs: [{}],
  execute: async () => {
    const apiUrl = Bun.env.AETHER_API_URL || "http://api.internal:8080";

    const response = await fetch(`${apiUrl}/internal/infra/types`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get infrastructure types: ${error}`);
    }

    const result = await response.json();
    return [{ type: "json" as const, value: result }];
  },
});

/**
 * All infrastructure-related custom tools for Codebuff
 */
export const infraTools = [provisionInfraTool, listInfraTool, getInfraTypesTool];
