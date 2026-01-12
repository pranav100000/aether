import { getDatabase } from "../db/client";
import type { SessionPayload, UsageRecord } from "../types";
import { calculateCost } from "./tokens";

export class UsageTracker {
  private session: SessionPayload;
  private provider: string;
  private model: string;
  private inputTokens: number = 0;
  private outputTokens: number = 0;

  constructor(session: SessionPayload, provider: string, model: string) {
    this.session = session;
    this.provider = provider;
    this.model = model;
  }

  addInputTokens(tokens: number): void {
    this.inputTokens += tokens;
  }

  addOutputTokens(tokens: number): void {
    this.outputTokens += tokens;
  }

  setTokens(input: number, output: number): void {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  async recordUsage(status: "completed" | "failed" = "completed"): Promise<void> {
    const cost = calculateCost(this.inputTokens, this.outputTokens, this.model);

    const record: UsageRecord = {
      user_id: this.session.user_id,
      project_id: this.session.project_id,
      provider: this.provider,
      model: this.model,
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cost_usd: cost,
      session_token_id: this.session.jti,
      status,
    };

    try {
      const db = getDatabase();
      await db.insertUsage(record);
    } catch (error) {
      // Log but don't fail the request if usage tracking fails
      console.error("Failed to record usage:", error);
    }
  }

  getUsage(): { inputTokens: number; outputTokens: number; cost: number } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cost: calculateCost(this.inputTokens, this.outputTokens, this.model),
    };
  }
}
