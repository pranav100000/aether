import type { AgentProvider, AgentType } from "../types";
import { ClaudeProvider } from "./claude";

const providers: Partial<Record<AgentType, AgentProvider>> = {
  claude: new ClaudeProvider(),
  // codex and opencode will be added in Phase 3
};

export function getProvider(agent: AgentType): AgentProvider {
  const provider = providers[agent];
  if (!provider) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Agent ${agent} is not configured (missing API key)`);
  }
  return provider;
}

export function getConfiguredAgents(): AgentType[] {
  return (Object.keys(providers) as AgentType[]).filter(
    (agent) => providers[agent]?.isConfigured()
  );
}
