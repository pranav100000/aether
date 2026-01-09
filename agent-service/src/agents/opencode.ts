import type { AgentProvider, AgentConfig, AgentMessage } from "../types";

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode" as const;

  isConfigured(): boolean {
    // OpenCode integration TBD
    return !!process.env.OPENCODE_API_KEY;
  }

  async *query(
    _prompt: string,
    _config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    yield {
      type: "error",
      error: "OpenCode provider not yet implemented",
    };
  }

  abort(): void {
    // No-op for now
  }
}
