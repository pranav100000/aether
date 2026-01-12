import type { LLMProvider, ProviderConfig } from "./base";
import type { StreamEvent, UsageInfo } from "../types";

// TODO: Implement Codebuff provider
export class CodebuffProvider implements LLMProvider {
  readonly name = "codebuff";
  private lastUsage: UsageInfo | null = null;

  isConfigured(): boolean {
    return !!process.env.CODEBUFF_API_KEY;
  }

  async *streamCompletion(
    _prompt: string,
    _config: ProviderConfig
  ): AsyncIterable<StreamEvent> {
    yield {
      type: "error",
      error: "Codebuff provider not yet implemented",
    };
  }

  getUsage(): UsageInfo | null {
    return this.lastUsage;
  }
}
