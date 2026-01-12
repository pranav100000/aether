import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UsageRecord } from "../types";

// Abstract interface for database operations - allows switching providers later
export interface DatabaseClient {
  insertUsage(usage: UsageRecord): Promise<void>;
  updateUsageStatus(
    id: string,
    status: "completed" | "failed",
    usage?: { inputTokens: number; outputTokens: number; cost: number }
  ): Promise<void>;
}

class SupabaseDatabaseClient implements DatabaseClient {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !serviceKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
    }

    this.client = createClient(url, serviceKey);
  }

  async insertUsage(usage: UsageRecord): Promise<void> {
    const { error } = await this.client.from("llm_usage").insert({
      user_id: usage.user_id,
      project_id: usage.project_id,
      provider: usage.provider,
      model: usage.model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: usage.cost_usd,
      session_token_id: usage.session_token_id,
      status: usage.status,
    });

    if (error) {
      throw new Error(`Failed to insert usage: ${error.message}`);
    }
  }

  async updateUsageStatus(
    id: string,
    status: "completed" | "failed",
    usage?: { inputTokens: number; outputTokens: number; cost: number }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      status,
      completed_at: new Date().toISOString(),
    };

    if (usage) {
      updateData.input_tokens = usage.inputTokens;
      updateData.output_tokens = usage.outputTokens;
      updateData.cost_usd = usage.cost;
    }

    const { error } = await this.client
      .from("llm_usage")
      .update(updateData)
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update usage: ${error.message}`);
    }
  }
}

let dbClient: DatabaseClient | null = null;

export function getDatabase(): DatabaseClient {
  if (!dbClient) {
    dbClient = new SupabaseDatabaseClient();
  }
  return dbClient;
}
