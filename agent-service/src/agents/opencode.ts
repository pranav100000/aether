import { createOpencode } from "@opencode-ai/sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "../types";

type OpenCodeClient = Awaited<ReturnType<typeof createOpencode>>["client"];

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode" as const;
  private client: OpenCodeClient | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  isConfigured(): boolean {
    // OpenCode uses provider-specific API keys
    // Check if at least one common provider key is available
    return !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.OPENROUTER_API_KEY
    );
  }

  private async getClient(): Promise<OpenCodeClient> {
    if (!this.client) {
      const { client } = await createOpencode();
      this.client = client;
    }
    return this.client;
  }

  private parseModel(model?: string): { providerID: string; modelID: string } {
    // Model format: "provider:model" e.g., "anthropic:claude-sonnet-4-20250514"
    if (model && model.includes(":")) {
      const [providerID, modelID] = model.split(":", 2);
      return { providerID, modelID };
    }
    // Default to Claude Sonnet
    return { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" };
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    const client = await this.getClient();
    this.abortController = new AbortController();

    try {
      // Create or reuse session
      if (!this.sessionId) {
        const session = await client.session.create({
          query: { directory: config.cwd },
        });
        if (session.data) {
          this.sessionId = session.data.id;
        }
      }

      if (!this.sessionId) {
        yield { type: "error", error: "Failed to create OpenCode session" };
        return;
      }

      // Build prompt with conversation history
      let fullPrompt = prompt;
      if (config.conversationHistory && config.conversationHistory.length > 0) {
        const historyText = config.conversationHistory
          .map(
            (msg) =>
              `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`
          )
          .join("\n\n");
        fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\nHuman: ${prompt}`;
      }

      // Parse model configuration
      const modelConfig = this.parseModel(config.model);

      // Subscribe to events before sending prompt
      const events = await client.event.subscribe();

      // Send prompt (don't await - we'll get response via events)
      client.session.prompt({
        path: { id: this.sessionId },
        body: {
          model: modelConfig,
          parts: [{ type: "text", text: fullPrompt }],
        },
      });

      // Process streaming events
      let currentContent = "";
      let isDone = false;

      for await (const event of events.stream) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        const mapped = this.mapEvent(event, config);
        if (mapped) {
          if (mapped.type === "text" && mapped.content) {
            currentContent += mapped.content;
          }
          if (mapped.type === "done") {
            isDone = true;
          }
          yield mapped;
        }

        // Break on turn complete
        if (event.type === "session.updated" && isDone) {
          break;
        }
      }

      if (!isDone) {
        yield { type: "done" };
      }
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private mapEvent(
    event: { type: string; properties?: unknown },
    config: AgentConfig
  ): AgentMessage | null {
    const props = event.properties as Record<string, unknown> | undefined;

    switch (event.type) {
      case "part.text.delta": {
        // Streaming text content
        const delta = props?.delta as string | undefined;
        if (delta) {
          return { type: "text", content: delta, streaming: true };
        }
        return null;
      }

      case "part.text": {
        // Complete text content
        const text = props?.text as string | undefined;
        if (text) {
          return { type: "text", content: text, streaming: false };
        }
        return null;
      }

      case "part.thinking.delta": {
        // Streaming thinking/reasoning
        const delta = props?.delta as string | undefined;
        if (delta) {
          return { type: "thinking", content: delta, streaming: true };
        }
        return null;
      }

      case "part.tool-invocation": {
        // Tool call
        const toolCall = props as {
          toolCallId?: string;
          toolName?: string;
          args?: Record<string, unknown>;
          state?: string;
        };
        if (toolCall) {
          return {
            type: "tool_use",
            tool: {
              id: toolCall.toolCallId || crypto.randomUUID(),
              name: toolCall.toolName || "unknown",
              input: toolCall.args || {},
              status: config.autoApprove ? "running" : "pending",
            },
          };
        }
        return null;
      }

      case "part.tool-result": {
        // Tool result
        const result = props as {
          toolCallId?: string;
          result?: unknown;
          isError?: boolean;
        };
        if (result) {
          return {
            type: "tool_result",
            toolId: result.toolCallId,
            result: typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result),
            error: result.isError ? String(result.result) : undefined,
          };
        }
        return null;
      }

      case "message.completed":
      case "session.completed": {
        // Turn complete
        const usage = props?.usage as {
          promptTokens?: number;
          completionTokens?: number;
        } | undefined;
        return {
          type: "done",
          usage: usage
            ? {
                inputTokens: usage.promptTokens || 0,
                outputTokens: usage.completionTokens || 0,
                cost: 0,
              }
            : undefined,
        };
      }

      default:
        return null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
