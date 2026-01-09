import type { AgentProvider, AgentType } from "../types";
import { ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { OpenCodeProvider } from "./opencode";

const providers: Record<AgentType, AgentProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  opencode: new OpenCodeProvider(),
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
