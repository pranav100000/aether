import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ProviderConfig } from "./base";
import type { StreamEvent, UsageInfo } from "../types";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  private client: Anthropic | null = null;
  private lastUsage: UsageInfo | null = null;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY not configured");
      }
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  async *streamCompletion(
    prompt: string,
    config: ProviderConfig
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient();

    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history if provided
    if (config.options?.conversationHistory) {
      for (const msg of config.options.conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add the current prompt
    messages.push({
      role: "user",
      content: prompt,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.options?.maxTokens || 4096,
        messages,
      });

      for await (const event of stream) {
        if (event.type === "message_start") {
          if (event.message.usage) {
            inputTokens = event.message.usage.input_tokens;
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield {
              type: "text",
              content: event.delta.text,
              streaming: true,
            };
          }
        } else if (event.type === "message_delta") {
          if (event.usage) {
            outputTokens = event.usage.output_tokens;
          }
        }
      }

      this.lastUsage = { inputTokens, outputTokens };

      yield {
        type: "done",
        usage: this.lastUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield {
        type: "error",
        error: message,
      };
    }
  }

  getUsage(): UsageInfo | null {
    return this.lastUsage;
  }
}
