import { Codex } from "@openai/codex-sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const
  private cwd: string
  private codex: Codex | null = null
  private currentThread: ReturnType<Codex["startThread"]> | null = null
  private abortController: AbortController | null = null

  constructor(config: ProviderConfig) {
    this.cwd = config.cwd
  }

  isConfigured(): boolean {
    return !!Bun.env.CODEX_API_KEY
  }

  private getCodex(): Codex {
    if (!this.codex) {
      this.codex = new Codex()
    }
    return this.codex
  }

  private mapSandboxMode(autoApprove: boolean): SandboxMode {
    return autoApprove ? "danger-full-access" : "workspace-write"
  }

  private mapReasoningEffort(thinkingTokens?: number): ModelReasoningEffort {
    return thinkingTokens && thinkingTokens > 0 ? "high" : "medium"
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController()
    const codex = this.getCodex()

    const thread = codex.startThread({
      workingDirectory: this.cwd,
      skipGitRepoCheck: true,
      sandboxMode: this.mapSandboxMode(options.autoApprove),
      modelReasoningEffort: this.mapReasoningEffort(options.thinkingTokens),
      model: options.model,
    })
    this.currentThread = thread

    const { events } = await thread.runStreamed(prompt)

    let hasDone = false
    for await (const event of events) {
      if (this.abortController?.signal.aborted) break

      const mapped = this.mapEvent(event, options.autoApprove)
      if (mapped) {
        if (mapped.type === "done") hasDone = true
        yield mapped
      }
    }

    if (!hasDone) {
      yield { type: "done" }
    }
  }

  private mapEvent(
    event: { type: string; item?: unknown; usage?: unknown },
    autoApprove: boolean
  ): AgentEvent | null {
    switch (event.type) {
      case "item.completed": {
        const item = event.item as Record<string, unknown>

        if (item.type === "reasoning") {
          return { type: "thinking", content: item.text as string, streaming: false }
        }

        if (item.type === "agent_message") {
          return { type: "text", content: item.text as string, streaming: false }
        }

        if (item.type === "function_call") {
          let parsedInput: Record<string, unknown> = {}
          try {
            parsedInput = JSON.parse((item.arguments as string) || "{}")
          } catch {
            // Keep empty object
          }

          return {
            type: "tool_use",
            tool: {
              id: (item.call_id as string) || crypto.randomUUID(),
              name: (item.name as string) || "unknown",
              input: parsedInput,
              status: autoApprove ? "running" : "pending",
            },
          }
        }

        if (item.type === "function_call_output") {
          return {
            type: "tool_result",
            toolId: item.call_id as string,
            result: String(item.output || ""),
          }
        }

        return null
      }

      case "turn.completed": {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
        if (usage) {
          return {
            type: "done",
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            },
          }
        }
        return null
      }

      default:
        return null
    }
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
    this.currentThread = null
  }
}
