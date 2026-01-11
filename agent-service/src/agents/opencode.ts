import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "../types";
import { buildFullPrompt } from "../utils/context";

type OpenCodeClient = Awaited<ReturnType<typeof createOpencode>>["client"];

const OPENCODE_PORT = 4096;

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode" as const;
  private client: OpenCodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private authConfigured = false;

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
    if (this.client) {
      return this.client;
    }

    // First, try to connect to an existing OpenCode server
    try {
      const client = createOpencodeClient({
        baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`,
      });
      // Test if server is actually running by making a simple request
      await client.app.info();
      this.client = client;
      console.error("[opencode] Connected to existing server");
    } catch {
      // No existing server, start a new one
      console.error("[opencode] Starting new server...");
      const { client, server } = await createOpencode({
        port: OPENCODE_PORT,
        hostname: "127.0.0.1",
      });
      this.client = client;
      this.server = server;
      console.error(`[opencode] Server started at ${server.url}`);
    }

    // Configure auth for providers
    if (!this.authConfigured) {
      await this.configureAuth(this.client);
      this.authConfigured = true;
    }

    return this.client;
  }

  private async configureAuth(client: OpenCodeClient): Promise<void> {
    // Set up auth for each available provider
    const providers = [
      { id: "anthropic", envKey: "ANTHROPIC_API_KEY" },
      { id: "openai", envKey: "OPENAI_API_KEY" },
      { id: "google", envKey: "GOOGLE_API_KEY" },
      { id: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ];

    for (const provider of providers) {
      const apiKey = process.env[provider.envKey];
      if (apiKey) {
        try {
          await client.auth.set({
            path: { id: provider.id },
            body: { type: "api", key: apiKey },
          });
          console.error(`[opencode] Configured auth for ${provider.id}`);
        } catch (err) {
          console.error(`[opencode] Failed to configure auth for ${provider.id}:`, err);
        }
      }
    }
  }

  private parseModel(model?: string): { providerID: string; modelID: string } {
    // Model format: "provider:model" e.g., "openrouter:anthropic/claude-sonnet-4"
    if (model && model.includes(":")) {
      const [providerID, modelID] = model.split(":", 2);
      return { providerID, modelID };
    }
    // Default to Anthropic Claude Sonnet
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
          console.error(`[opencode] Created session: ${this.sessionId}`);
        }
      }

      if (!this.sessionId) {
        yield { type: "error", error: "Failed to create OpenCode session" };
        return;
      }

      // Build prompt with file context and conversation history
      const fullPrompt = buildFullPrompt(
        prompt,
        config.fileContext,
        config.conversationHistory,
        "markdown"
      );

      // Parse model configuration
      const modelConfig = this.parseModel(config.model);
      console.error(`[opencode] Using model: ${modelConfig.providerID}/${modelConfig.modelID}`);

      // Subscribe to events before sending prompt
      const events = await client.event.subscribe();

      // Send prompt - catch errors but don't block (events come via subscription)
      const promptPromise = client.session.prompt({
        path: { id: this.sessionId },
        body: {
          model: modelConfig,
          parts: [{ type: "text", text: fullPrompt }],
        },
      }).catch((err: Error) => {
        console.error("[opencode] Prompt error:", err);
        return { error: err };
      });

      // Process streaming events
      let isDone = false;
      let eventCount = 0;

      for await (const event of events.stream) {
        eventCount++;

        if (this.abortController?.signal.aborted) {
          break;
        }

        // Debug: log event types to stderr
        console.error(`[opencode] Event ${eventCount}: ${event.type}`);

        const mapped = this.mapEvent(event, config);
        if (mapped) {
          if (mapped.type === "done") {
            isDone = true;
          }
          yield mapped;
        }

        // Break on session idle (turn complete)
        if (isDone || event.type === "session.idle") {
          break;
        }
      }

      // Check if prompt had an error
      const promptResult = await promptPromise;
      if (promptResult && "error" in promptResult) {
        yield { type: "error", error: String(promptResult.error) };
        return;
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
      case "message.part.updated": {
        // Part updated - check the part type
        // Part has: id, sessionID, messageID, type, text, etc.
        // Also may have delta for streaming increments
        const delta = props?.delta as string | undefined;
        const part = props?.part as {
          type?: string;
          text?: string;
          callID?: string;
          tool?: string;
          state?: { type?: string; input?: Record<string, unknown>; output?: unknown };
        } | undefined;

        if (!part) return null;

        // Use delta for streaming if available, otherwise use full text
        const content = delta || part.text;

        if (part.type === "text" && content) {
          return { type: "text", content, streaming: !!delta };
        }

        if (part.type === "reasoning" && content) {
          return { type: "thinking", content, streaming: !!delta };
        }

        if (part.type === "tool" && part.tool) {
          // ToolPart has: callID, tool (tool name), state (ToolState)
          // ToolState can be: pending, running, completed, error
          const state = part.state;
          const stateType = state?.type || "pending";

          // For tool results (completed or error state)
          if (stateType === "completed" || stateType === "error") {
            return {
              type: "tool_result",
              toolId: part.callID,
              result: typeof state?.output === "string"
                ? state.output
                : JSON.stringify(state?.output || ""),
              error: stateType === "error" ? String(state?.output) : undefined,
            };
          }

          // For tool invocations (pending or running)
          return {
            type: "tool_use",
            tool: {
              id: part.callID || crypto.randomUUID(),
              name: part.tool,
              input: state?.input || {},
              status: config.autoApprove ? "running" : "pending",
            },
          };
        }

        return null;
      }

      case "message.updated": {
        // Full message update - extract text content
        const message = props?.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        if (message?.content) {
          const textParts = message.content
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("");
          if (textParts) {
            return { type: "text", content: textParts, streaming: false };
          }
        }
        return null;
      }

      case "session.idle": {
        // Session finished processing
        return { type: "done" };
      }

      case "session.status": {
        // Check if session is done
        const status = props?.status as { state?: string } | undefined;
        if (status?.state === "idle") {
          return { type: "done" };
        }
        return null;
      }

      case "session.error": {
        // Session error
        const error = props?.error as { message?: string } | undefined;
        return {
          type: "error",
          error: error?.message || "Unknown session error",
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
