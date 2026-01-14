import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import type { AgentProvider, AgentEvent, QueryOptions, ProviderConfig } from "../types"

type OpenCodeClient = Awaited<ReturnType<typeof createOpencode>>["client"]

const OPENCODE_PORT = 4096

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode" as const
  private cwd: string
  private client: OpenCodeClient | null = null
  private server: { url: string; close(): void } | null = null
  private sessionId: string | null = null
  private abortController: AbortController | null = null
  private authConfigured = false

  constructor(config: ProviderConfig) {
    this.cwd = config.cwd
  }

  isConfigured(): boolean {
    return !!(
      Bun.env.ANTHROPIC_API_KEY ||
      Bun.env.OPENAI_API_KEY ||
      Bun.env.GOOGLE_API_KEY ||
      Bun.env.OPENROUTER_API_KEY
    )
  }

  private async getClient(): Promise<OpenCodeClient> {
    if (this.client) return this.client

    try {
      const client = createOpencodeClient({
        baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`,
      })
      await (client.app as unknown as { info(): Promise<unknown> }).info()
      this.client = client
    } catch {
      const { client, server } = await createOpencode({
        port: OPENCODE_PORT,
        hostname: "127.0.0.1",
      })
      this.client = client
      this.server = server
    }

    if (!this.authConfigured) {
      await this.configureAuth(this.client)
      this.authConfigured = true
    }

    return this.client
  }

  private async configureAuth(client: OpenCodeClient): Promise<void> {
    const providers = [
      { id: "anthropic", envKey: "ANTHROPIC_API_KEY" },
      { id: "openai", envKey: "OPENAI_API_KEY" },
      { id: "google", envKey: "GOOGLE_API_KEY" },
      { id: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ]

    for (const provider of providers) {
      const apiKey = Bun.env[provider.envKey]
      if (apiKey) {
        try {
          await client.auth.set({
            path: { id: provider.id },
            body: { type: "api", key: apiKey },
          })
        } catch {
          // Ignore auth errors
        }
      }
    }
  }

  private parseModel(model?: string): { providerID: string; modelID: string } {
    if (model && model.includes(":")) {
      const [providerID, modelID] = model.split(":", 2)
      return { providerID, modelID }
    }
    return { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    const client = await this.getClient()
    this.abortController = new AbortController()

    try {
      if (!this.sessionId) {
        const session = await client.session.create({
          query: { directory: this.cwd },
        })
        if (session.data) {
          this.sessionId = session.data.id
        }
      }

      if (!this.sessionId) {
        yield { type: "error", error: "Failed to create OpenCode session" }
        return
      }

      const modelConfig = this.parseModel(options.model)
      const events = await client.event.subscribe()

      client.session.prompt({
        path: { id: this.sessionId },
        body: {
          model: modelConfig,
          parts: [{ type: "text", text: prompt }],
        },
      }).catch(() => {})

      let isDone = false
      for await (const event of events.stream) {
        if (this.abortController?.signal.aborted) break

        const mapped = this.mapEvent(event, options.autoApprove)
        if (mapped) {
          if (mapped.type === "done") isDone = true
          yield mapped
        }

        if (isDone || event.type === "session.idle") break
      }

      if (!isDone) {
        yield { type: "done" }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) }
    }
  }

  private mapEvent(
    event: { type: string; properties?: unknown },
    autoApprove: boolean
  ): AgentEvent | null {
    const props = event.properties as Record<string, unknown> | undefined

    switch (event.type) {
      case "message.part.updated": {
        const delta = props?.delta as string | undefined
        const part = props?.part as {
          type?: string
          text?: string
          callID?: string
          tool?: string
          state?: { type?: string; input?: Record<string, unknown>; output?: unknown }
        } | undefined

        if (!part) return null

        const content = delta || part.text

        if (part.type === "text" && content) {
          return { type: "text", content, streaming: !!delta }
        }

        if (part.type === "reasoning" && content) {
          return { type: "thinking", content, streaming: !!delta }
        }

        if (part.type === "tool" && part.tool) {
          const state = part.state
          const stateType = state?.type || "pending"

          if (stateType === "completed" || stateType === "error") {
            return {
              type: "tool_result",
              toolId: part.callID,
              result: typeof state?.output === "string"
                ? state.output
                : JSON.stringify(state?.output || ""),
              error: stateType === "error" ? String(state?.output) : undefined,
            }
          }

          return {
            type: "tool_use",
            tool: {
              id: part.callID || crypto.randomUUID(),
              name: part.tool,
              input: state?.input || {},
              status: autoApprove ? "running" : "pending",
            },
          }
        }

        return null
      }

      case "session.idle":
        return { type: "done" }

      case "session.status": {
        const status = props?.status as { state?: string } | undefined
        if (status?.state === "idle") return { type: "done" }
        return null
      }

      case "session.error": {
        const error = props?.error as { message?: string } | undefined
        return { type: "error", error: error?.message || "Unknown session error" }
      }

      default:
        return null
    }
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}
