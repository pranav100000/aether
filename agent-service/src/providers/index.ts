import type { LLMProvider } from "./base";
import { ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { CodebuffProvider } from "./codebuff";
import { OpenCodeProvider } from "./opencode";

export type ProviderType = "claude" | "codex" | "codebuff" | "opencode";

const providers: Record<ProviderType, () => LLMProvider> = {
  claude: () => new ClaudeProvider(),
  codex: () => new CodexProvider(),
  codebuff: () => new CodebuffProvider(),
  opencode: () => new OpenCodeProvider(),
};

export function getProvider(type: ProviderType): LLMProvider {
  const factory = providers[type];
  if (!factory) {
    throw new Error(`Unknown provider: ${type}`);
  }
  return factory();
}

export function getAvailableProviders(): Record<ProviderType, boolean> {
  return {
    claude: new ClaudeProvider().isConfigured(),
    codex: new CodexProvider().isConfigured(),
    codebuff: new CodebuffProvider().isConfigured(),
    opencode: new OpenCodeProvider().isConfigured(),
  };
}
