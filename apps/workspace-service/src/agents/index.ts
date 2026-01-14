import type { AgentType, AgentProvider, ProviderConfig } from "../types"
import { ClaudeProvider } from "./claude"
import { CodebuffProvider } from "./codebuff"
import { CodexProvider } from "./codex"
import { OpenCodeProvider } from "./opencode"

type ProviderClass = new (config: ProviderConfig) => AgentProvider

const providerClasses: Record<AgentType, ProviderClass> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
  codebuff: CodebuffProvider,
  opencode: OpenCodeProvider,
}

/** Create a provider instance for the given agent type */
export function createProvider(agent: AgentType, config: ProviderConfig): AgentProvider {
  const ProviderClass = providerClasses[agent]
  if (!ProviderClass) {
    throw new Error(`Unknown agent: ${agent}`)
  }
  return new ProviderClass(config)
}

/** Check if an agent type is configured (has required API keys) */
export function isAgentConfigured(agent: AgentType): boolean {
  // Create a temporary instance to check configuration
  // This is a bit wasteful but keeps the check logic in the provider
  const tempConfig: ProviderConfig = { cwd: process.cwd() }
  const provider = new providerClasses[agent](tempConfig)
  return provider.isConfigured()
}

/** Get list of all configured agent types */
export function getConfiguredAgents(): AgentType[] {
  return (Object.keys(providerClasses) as AgentType[]).filter(isAgentConfigured)
}
