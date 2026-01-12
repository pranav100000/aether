import type { LLMProvider, ProviderConfig } from "./base";
import type { StreamEvent, UsageInfo } from "../types";

// TODO: Implement OpenCode provider
export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  private lastUsage: UsageInfo | null = null;

  isConfigured(): boolean {
    return !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY
    );
  }

  async *streamCompletion(
    _prompt: string,
    _config: ProviderConfig
  ): AsyncIterable<StreamEvent> {
    yield {
      type: "error",
      error: "OpenCode provider not yet implemented",
    };
  }

  getUsage(): UsageInfo | null {
    return this.lastUsage;
  }
}
