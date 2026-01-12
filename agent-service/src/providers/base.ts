import type { CompletionOptions, StreamEvent, UsageInfo } from "../types";

export interface ProviderConfig {
  model: string;
  options?: CompletionOptions;
}

export interface LLMProvider {
  readonly name: string;

  isConfigured(): boolean;

  streamCompletion(
    prompt: string,
    config: ProviderConfig
  ): AsyncIterable<StreamEvent>;

  getUsage(): UsageInfo | null;
}
