import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProvider, AgentConfig, AgentMessage, PermissionMode } from "../types";

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private getModelId(model?: string): string {
    // Map short names to full model IDs
    switch (model) {
      case "opus":
        return "claude-opus-4-5-20250929";
      case "sonnet":
        return "claude-sonnet-4-5-20250929";
      case "haiku":
        return "claude-haiku-3-5-20250929";
      default:
        return model || "claude-sonnet-4-5-20250929";
    }
  }

  private mapPermissionMode(mode?: PermissionMode): "default" | "acceptEdits" | "plan" | "bypassPermissions" {
    return mode || "default";
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    this.abortController = new AbortController();

    try {
      const modelId = this.getModelId(config.model);

      // Build prompt with conversation history if available
      let fullPrompt = prompt;
      if (config.conversationHistory && config.conversationHistory.length > 0) {
        const historyText = config.conversationHistory
          .map((msg) => `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`)
          .join("\n\n");
        fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\nHuman: ${prompt}`;
      }

      // Use the SDK's query function with full options support
      const q = query({
        prompt: fullPrompt,
        options: {
          model: modelId,
          cwd: config.cwd,
          permissionMode: config.autoApprove ? "bypassPermissions" : this.mapPermissionMode(config.permissionMode),
          abortController: this.abortController,
          // Enable extended thinking if requested
          ...(config.extendedThinking ? { maxThinkingTokens: 10000 } : {}),
          // Resume session if we have a session ID
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          // Allow all tools for full agent capabilities
          allowedTools: [
            "Read",
            "Write",
            "Edit",
            "Bash",
            "Glob",
            "Grep",
            "WebSearch",
            "WebFetch",
            "TodoWrite",
            "Task",
          ],
        },
      });

      // Stream messages from the query
      for await (const msg of q) {
        // Capture session ID for future resumption
        if (msg.session_id && !this.sessionId) {
          this.sessionId = msg.session_id;
        }

        const mapped = this.mapSDKMessage(msg, config);
        if (mapped) {
          yield mapped;
        }
      }

      yield { type: "done" };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private mapSDKMessage(msg: SDKMessage, config: AgentConfig): AgentMessage | null {
    switch (msg.type) {
      case "system": {
        // System init message - could emit session info
        if ("subtype" in msg && msg.subtype === "init") {
          return null; // We handle session ID capture in the main loop
        }
        return null;
      }

      case "assistant": {
        // Extract content from assistant message
        type ContentBlock = {
          type: string;
          text?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: unknown;
        };
        const content = msg.message.content as ContentBlock[];

        // Check for thinking blocks first (extended thinking)
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            return { type: "thinking", content: block.thinking, streaming: false };
          }
        }

        // Then collect text content
        const textContent = content
          .filter((block: ContentBlock): block is ContentBlock & { type: "text"; text: string } =>
            block.type === "text" && typeof block.text === "string"
          )
          .map((block) => block.text)
          .join("");

        if (textContent) {
          return { type: "text", content: textContent, streaming: false };
        }

        // Handle tool use blocks
        for (const block of content) {
          if (block.type === "tool_use" && block.id && block.name) {
            return {
              type: "tool_use",
              tool: {
                id: block.id,
                name: block.name,
                input: (block.input || {}) as Record<string, unknown>,
                status: config.autoApprove ? "running" : "pending",
              },
            };
          }
        }

        return null;
      }

      case "result": {
        // Result message contains usage stats and final status
        // Don't emit the result text - it duplicates what came in assistant messages
        const resultMsg = msg as {
          type: "result";
          subtype: string;
          errors?: string[];
        };

        // Only emit errors, not success (content already came in assistant messages)
        if (resultMsg.subtype.startsWith("error") && resultMsg.errors) {
          return { type: "error", error: resultMsg.errors.join("; ") };
        }

        return null;
      }

      case "stream_event": {
        // Handle streaming events for real-time content (partial messages)
        // This is SDKPartialAssistantMessage type
        if ("event" in msg) {
          const event = msg.event as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
          };
          if (event.type === "content_block_delta") {
            // Handle text streaming
            if (event.delta?.type === "text_delta" && event.delta.text) {
              return { type: "text", content: event.delta.text, streaming: true };
            }
            // Handle thinking streaming
            if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
              return { type: "thinking", content: event.delta.thinking, streaming: true };
            }
          }
        }
        return null;
      }

      case "user": {
        // User messages are replays, we don't need to emit them
        return null;
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
