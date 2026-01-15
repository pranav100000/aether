import { CodebuffClient } from "@codebuff/sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

const AGENT = "codebuff/base2-max@0.0.24"

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const
  private client: CodebuffClient
  private abortController: AbortController | null = null

  constructor(config: ProviderConfig) {
    this.client = new CodebuffClient({ apiKey: Bun.env.CODEBUFF_API_KEY!, cwd: config.cwd })
  }

  isConfigured(): boolean {
    return !!Bun.env.CODEBUFF_API_KEY && !!Bun.env.CODEBUFF_BYOK_OPENROUTER
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController()
    const queue: AgentEvent[] = []
    let resolve: (() => void) | null = null
    let done = false

    const push = (e: AgentEvent) => { queue.push(e); resolve?.(); resolve = null }

    console.log("[Codebuff] Starting run with prompt:", prompt.slice(0, 500))
    const result = this.client.run({
      agent: AGENT,
      prompt,
      signal: this.abortController.signal,
      handleStreamChunk: (chunk) => {
        console.log("[Codebuff] chunk:", typeof chunk === "string" ? chunk.slice(0, 100) : chunk)
        if (typeof chunk === "string") {
          push({ type: "text", content: chunk, streaming: true })
        }
      },
      handleEvent: (e) => {
        console.log("[Codebuff] event:", e.type, e)
        if (e.type === "tool_call") {
          const toolName = e.toolName as string
          // Skip internal control flow tools - they're handled by the SDK
          if (toolName === "end_turn" || toolName === "task_completed") {
            return
          }
          push({ type: "tool_use", tool: { id: e.toolCallId as string, name: toolName, input: e.input as Record<string, unknown>, status: options.autoApprove ? "running" : "pending" } })
        } else if (e.type === "tool_result") {
          push({ type: "tool_result", toolId: e.toolCallId as string, result: JSON.stringify(e.output) })
        }
      },
    }).catch(err => { push({ type: "error", error: err.message }) }).finally(() => { done = true; resolve?.() })

    while (!done || queue.length > 0) {
      while (queue.length > 0) yield queue.shift()!
      if (!done) await new Promise<void>(r => { resolve = r })
    }

    await result
    yield { type: "done" }
  }

  abort(): void { this.abortController?.abort() }
}
