import type { LLMProvider, ProviderConfig } from "./base";
import type { StreamEvent, UsageInfo } from "../types";

// TODO: Implement Codex provider using OpenAI API
export class CodexProvider implements LLMProvider {
  readonly name = "codex";
  private lastUsage: UsageInfo | null = null;

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async *streamCompletion(
    _prompt: string,
    _config: ProviderConfig
  ): AsyncIterable<StreamEvent> {
    yield {
      type: "error",
      error: "Codex provider not yet implemented",
    };
  }

  getUsage(): UsageInfo | null {
    return this.lastUsage;
  }
}
