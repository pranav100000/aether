import { CodebuffClient } from "@codebuff/sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

type RunState = Awaited<ReturnType<CodebuffClient["run"]>>

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const
  private cwd: string
  private client: CodebuffClient | null = null
  private previousRun: RunState | null = null
  private abortController: AbortController | null = null

  constructor(config: ProviderConfig) {
    this.cwd = config.cwd
  }

  isConfigured(): boolean {
    return !!process.env.CODEBUFF_API_KEY && !!process.env.CODEBUFF_BYOK_OPENROUTER
  }

  private getClient(): CodebuffClient {
    if (!this.client) {
      this.client = new CodebuffClient({
        apiKey: process.env.CODEBUFF_API_KEY!,
        cwd: this.cwd,
      })
    }
    return this.client
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController()
    const client = this.getClient()

    const eventQueue: AgentEvent[] = []
    let resolveWait: (() => void) | null = null
    let isComplete = false

    const handleEvent = (event: { type: string; [key: string]: unknown }) => {
      const mapped = this.mapEvent(event, options.autoApprove)
      if (mapped) {
        eventQueue.push(mapped)
        // Always try to resolve - even if null, this is safe
        resolveWait?.()
        resolveWait = null
      }
    }

    const runPromise = client
      .run({
        agent: options.model || "base2",
        prompt,
        handleEvent,
        signal: this.abortController.signal,
        ...(this.previousRun ? { previousRun: this.previousRun } : {}),
      })
      .then((result: RunState) => {
        // Only update state if not aborted
        if (!this.abortController?.signal.aborted) {
          this.previousRun = result
        }
        isComplete = true
        resolveWait?.()
        resolveWait = null
        return result
      })
      .catch((err: Error) => {
        // Only report errors if not aborted (abort may cause expected errors)
        if (!this.abortController?.signal.aborted) {
          eventQueue.push({ type: "error", error: err.message })
        }
        isComplete = true
        resolveWait?.()
        resolveWait = null
        throw err
      })

    // Main event loop
    while (true) {
      if (this.abortController?.signal.aborted) break

      // Drain all available events first
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!
      }

      // Exit only after queue is empty AND processing is complete
      if (isComplete) break

      // Wait for next event or completion signal
      await new Promise<void>((resolve) => {
        resolveWait = resolve
        // Also resolve on abort to prevent hanging
        const onAbort = () => resolve()
        this.abortController?.signal.addEventListener("abort", onAbort, { once: true })
      })
    }

    // Ensure the SDK promise is fully settled
    try {
      await runPromise
    } catch {
      // Error already pushed to queue
    }

    // Final drain: catch any events that arrived during promise settlement
    // This is critical - events can arrive between isComplete=true and await runPromise
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!
    }

    yield { type: "done" }
  }

  private mapEvent(
    event: { type: string; [key: string]: unknown },
    autoApprove: boolean
  ): AgentEvent | null {
    switch (event.type) {
      case "text": {
        const text = event.text as string | undefined
        if (text) {
          return { type: "text", content: text, streaming: true }
        }
        return null
      }

      case "reasoning_delta": {
        // Extended thinking/reasoning from the model
        const text = event.text as string | undefined
        if (text) {
          return { type: "thinking", content: text, streaming: true }
        }
        return null
      }

      case "tool_call": {
        const toolName = event.toolName as string | undefined
        const toolCallId = event.toolCallId as string | undefined
        const input = event.input as Record<string, unknown> | undefined

        if (toolName) {
          return {
            type: "tool_use",
            tool: {
              id: toolCallId || crypto.randomUUID(),
              name: toolName,
              input: input || {},
              status: autoApprove ? "running" : "pending",
            },
          }
        }
        return null
      }

      case "tool_result": {
        const toolCallId = event.toolCallId as string | undefined
        const output = event.output as unknown

        return {
          type: "tool_result",
          toolId: toolCallId,
          result: typeof output === "string" ? output : JSON.stringify(output),
        }
      }

      case "subagent_start": {
        // Subagent spawned - display as a tool use for visibility
        const agentId = event.agentId as string | undefined
        const agentType = event.agentType as string | undefined
        const displayName = event.displayName as string | undefined

        return {
          type: "tool_use",
          tool: {
            id: agentId || crypto.randomUUID(),
            name: "spawn_agent_inline",
            input: {
              agent_type: agentType || "unknown",
              displayName: displayName,
            },
            status: "running",
          },
        }
      }

      case "subagent_finish": {
        // Subagent completed
        const agentId = event.agentId as string | undefined

        return {
          type: "tool_result",
          toolId: agentId,
          result: JSON.stringify([{ type: "json", value: { message: "Agent completed" } }]),
        }
      }

      case "error": {
        const message = event.message as string | undefined
        return { type: "error", error: message || "Unknown error" }
      }

      case "start":
      case "finish":
        // These are SDK lifecycle events, not user-facing
        // finish doesn't mean completion (that's when Promise resolves)
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
