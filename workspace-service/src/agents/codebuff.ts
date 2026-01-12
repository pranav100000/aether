import { CodebuffClient } from "@codebuff/sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

type RunState = Awaited<ReturnType<CodebuffClient["run"]>>

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const
  private cwd: string
  private client: CodebuffClient | null = null
  private previousRun: RunState | null = null

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
    const client = this.getClient()

    const eventQueue: AgentEvent[] = []
    let resolveWait: (() => void) | null = null
    let isComplete = false

    const handleEvent = (event: { type: string; [key: string]: unknown }) => {
      const mapped = this.mapEvent(event, options.autoApprove)
      if (mapped) {
        eventQueue.push(mapped)
        if (resolveWait) {
          resolveWait()
          resolveWait = null
        }
      }
    }

    const runPromise = client
      .run({
        agent: options.model || "base2",
        prompt,
        handleEvent,
        ...(this.previousRun ? { previousRun: this.previousRun } : {}),
      })
      .then((result: RunState) => {
        this.previousRun = result
        isComplete = true
        resolveWait?.()
        resolveWait = null
        return result
      })
      .catch((err: Error) => {
        eventQueue.push({ type: "error", error: err.message })
        isComplete = true
        resolveWait?.()
        resolveWait = null
        throw err
      })

    while (!isComplete || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!
      } else if (!isComplete) {
        await new Promise<void>((resolve) => {
          resolveWait = resolve
        })
      }
    }

    try {
      await runPromise
    } catch {
      // Error already pushed to queue
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

      case "error": {
        const message = event.message as string | undefined
        return { type: "error", error: message || "Unknown error" }
      }

      default:
        return null
    }
  }

  abort(): void {
    this.previousRun = null
  }
}
