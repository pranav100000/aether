import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const
  private cwd: string
  private sessionId: string | null = null
  private abortController: AbortController | null = null

  constructor(config: ProviderConfig) {
    this.cwd = config.cwd
  }

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY
  }

  private getModelId(model?: string): string {
    switch (model) {
      case "opus":
        return "claude-opus-4-5-20250929"
      case "sonnet":
        return "claude-sonnet-4-5-20250929"
      case "haiku":
        return "claude-haiku-3-5-20250929"
      default:
        return model || "claude-sonnet-4-5-20250929"
    }
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController()

    try {
      const q = query({
        prompt,
        options: {
          model: this.getModelId(options.model),
          cwd: this.cwd,
          permissionMode: options.autoApprove ? "bypassPermissions" : "default",
          abortController: this.abortController,
          ...(options.thinkingTokens ? { maxThinkingTokens: options.thinkingTokens } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite", "Task"],
        },
      })

      for await (const msg of q) {
        // Check if aborted before processing
        if (this.abortController?.signal.aborted) {
          yield { type: "done" }
          return
        }

        if (msg.session_id && !this.sessionId) {
          this.sessionId = msg.session_id
        }

        const event = this.mapMessage(msg, options.autoApprove)
        if (event) yield event
      }

      yield { type: "done" }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) }
    }
  }

  private mapMessage(msg: SDKMessage, autoApprove: boolean): AgentEvent | null {
    switch (msg.type) {
      case "system":
        return null

      case "assistant": {
        type ContentBlock = {
          type: string
          text?: string
          thinking?: string
          id?: string
          name?: string
          input?: unknown
        }
        const content = msg.message.content as ContentBlock[]

        // Check for thinking blocks
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            return { type: "thinking", content: block.thinking, streaming: false }
          }
        }

        // Collect text content
        const textContent = content
          .filter((b): b is ContentBlock & { type: "text"; text: string } =>
            b.type === "text" && typeof b.text === "string"
          )
          .map((b) => b.text)
          .join("")

        if (textContent) {
          return { type: "text", content: textContent, streaming: false }
        }

        // Handle tool use
        for (const block of content) {
          if (block.type === "tool_use" && block.id && block.name) {
            return {
              type: "tool_use",
              tool: {
                id: block.id,
                name: block.name,
                input: (block.input || {}) as Record<string, unknown>,
                status: autoApprove ? "running" : "pending",
              },
            }
          }
        }

        return null
      }

      case "result": {
        const resultMsg = msg as { type: "result"; subtype: string; errors?: string[] }
        if (resultMsg.subtype.startsWith("error") && resultMsg.errors) {
          return { type: "error", error: resultMsg.errors.join("; ") }
        }
        return null
      }

      case "stream_event": {
        if ("event" in msg) {
          const event = msg.event as {
            type?: string
            delta?: { type?: string; text?: string; thinking?: string }
          }
          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta" && event.delta.text) {
              return { type: "text", content: event.delta.text, streaming: true }
            }
            if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
              return { type: "thinking", content: event.delta.thinking, streaming: true }
            }
          }
        }
        return null
      }

      case "user":
        return null

      default:
        return null
    }
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}
