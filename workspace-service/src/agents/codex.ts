import { Codex } from "@openai/codex-sdk";
import type { AgentProvider, AgentConfig, AgentMessage, PermissionMode } from "../types";
import { buildFullPrompt } from "../utils/context";

type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  private codex: Codex | null = null;
  private currentThread: ReturnType<Codex["startThread"]> | null = null;

  isConfigured(): boolean {
    // Codex SDK uses CODEX_API_KEY, not OPENAI_API_KEY
    return !!process.env.CODEX_API_KEY;
  }

  private getCodex(): Codex {
    if (!this.codex) {
      this.codex = new Codex();
    }
    return this.codex;
  }

  // Map our permission modes to Codex sandbox modes
  private mapSandboxMode(permissionMode?: PermissionMode): SandboxMode {
    switch (permissionMode) {
      case "bypassPermissions":
        return "danger-full-access";
      case "acceptEdits":
        return "workspace-write";
      case "plan":
        return "read-only";
      case "default":
      default:
        return "workspace-write";
    }
  }

  // Map extended thinking to reasoning effort
  private mapReasoningEffort(extendedThinking?: boolean): ModelReasoningEffort {
    return extendedThinking ? "high" : "medium";
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    const codex = this.getCodex();

    // Start thread with working directory and mapped settings
    const thread = codex.startThread({
      workingDirectory: config.cwd,
      skipGitRepoCheck: true,
      sandboxMode: this.mapSandboxMode(config.permissionMode),
      modelReasoningEffort: this.mapReasoningEffort(config.extendedThinking),
      model: config.model,
    });
    this.currentThread = thread;

    // Build prompt with file context and conversation history
    const fullPrompt = buildFullPrompt(
      prompt,
      config.fileContext,
      config.conversationHistory,
      "markdown"
    );

    // Use runStreamed for real-time events
    const { events } = await thread.runStreamed(fullPrompt);

    let hasDone = false;
    for await (const event of events) {
      const mapped = this.mapEvent(event, config);
      if (mapped) {
        if (mapped.type === "done") {
          hasDone = true;
        }
        yield mapped;
      }
    }

    // Only yield done if we didn't get one from turn.completed
    if (!hasDone) {
      yield { type: "done" };
    }
  }

  private mapEvent(
    event: { type: string; item?: unknown; usage?: unknown },
    config: AgentConfig
  ): AgentMessage | null {
    switch (event.type) {
      case "item.completed": {
        const item = event.item as Record<string, unknown>;

        // Handle reasoning/thinking
        if (item.type === "reasoning") {
          return {
            type: "thinking",
            content: item.text as string,
            streaming: false,
          };
        }

        // Handle agent message (main text output)
        if (item.type === "agent_message") {
          return {
            type: "text",
            content: item.text as string,
            streaming: false,
          };
        }

        // Handle function/tool calls
        if (item.type === "function_call") {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse((item.arguments as string) || "{}");
          } catch {
            // Keep empty object if parsing fails
          }

          return {
            type: "tool_use",
            tool: {
              id: (item.call_id as string) || crypto.randomUUID(),
              name: (item.name as string) || "unknown",
              input: parsedInput,
              status: config.autoApprove ? "running" : "pending",
            },
          };
        }

        // Handle function/tool results
        if (item.type === "function_call_output") {
          return {
            type: "tool_result",
            toolId: item.call_id as string,
            result: String(item.output || ""),
          };
        }

        return null;
      }

      case "turn.completed": {
        const usage = event.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          return {
            type: "done",
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cost: 0, // TODO: Calculate based on model pricing
            },
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  abort(): void {
    // The SDK doesn't expose a direct abort method
    // Thread will be cleaned up on next run
    this.currentThread = null;
  }
}
