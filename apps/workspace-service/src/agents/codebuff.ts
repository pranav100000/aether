import { CodebuffClient, type RunState } from "@codebuff/sdk"
import type {
  AgentProvider,
  AgentEvent,
  QueryOptions,
  ProviderConfig,
  ToolResponsePayload,
} from "../types"

const AGENT = "codebuff/base2-max@0.0.24"

/** Tools that require human-in-the-loop interaction */
const HUMAN_IN_THE_LOOP_TOOLS = ["ask_user"] as const

interface PendingToolCall {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const
  private client: CodebuffClient
  private abortController: AbortController | null = null
  private lastRunState: RunState | null = null
  private pendingToolCall: PendingToolCall | null = null

  constructor(config: ProviderConfig) {
    this.client = new CodebuffClient({ apiKey: Bun.env.CODEBUFF_API_KEY!, cwd: config.cwd })
  }

  isConfigured(): boolean {
    return !!Bun.env.CODEBUFF_API_KEY && !!Bun.env.CODEBUFF_BYOK_OPENROUTER
  }

  hasPendingRun(): boolean {
    return this.pendingToolCall !== null && this.lastRunState !== null
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    // Clear any previous pending state when starting a new query
    this.pendingToolCall = null
    yield* this.runAgent(prompt, options, undefined, undefined)
  }

  async *continueWithToolResponse(
    toolResponse: ToolResponsePayload,
    options: QueryOptions
  ): AsyncIterable<AgentEvent> {
    if (!this.lastRunState || !this.pendingToolCall) {
      yield { type: "error", error: "No pending run to continue" }
      return
    }

    if (toolResponse.toolId !== this.pendingToolCall.toolCallId) {
      yield {
        type: "error",
        error: `Tool ID mismatch: expected ${this.pendingToolCall.toolCallId}, got ${toolResponse.toolId}`,
      }
      return
    }

    // Format the response as a tool result for the SDK
    const toolResult = {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: this.pendingToolCall.toolCallId,
          toolName: this.pendingToolCall.toolName,
          result: this.formatToolResponse(toolResponse),
        },
      ],
    }

    // Clear the pending state before continuing
    const previousRun = this.lastRunState
    this.pendingToolCall = null

    // Continue the run with the tool response
    yield* this.runAgent("", options, previousRun, [toolResult])
  }

  private formatToolResponse(toolResponse: ToolResponsePayload): unknown[] {
    // Format ask_user response according to the SDK's expected output schema
    if (toolResponse.toolName === "ask_user") {
      const response = toolResponse.response as {
        answers: Record<number, number[]>
        customAnswers?: Record<number, string>
      }

      // Build the response in the format the SDK expects
      const formattedAnswers: Record<string, string | string[]> = {}
      for (const [questionIdx, selectedOptions] of Object.entries(response.answers)) {
        const key = `question_${questionIdx}`
        // If there's a custom answer, use that
        if (response.customAnswers?.[Number(questionIdx)]) {
          formattedAnswers[key] = response.customAnswers[Number(questionIdx)]
        } else {
          // Otherwise use the selected option indices
          formattedAnswers[key] = selectedOptions.map(String)
        }
      }

      return [{ type: "json", json: { answers: formattedAnswers } }]
    }

    // Default: wrap the response as JSON
    return [{ type: "json", json: toolResponse.response }]
  }

  private async *runAgent(
    prompt: string,
    options: QueryOptions,
    previousRun?: RunState,
    extraToolResults?: unknown[]
  ): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController()
    const queue: AgentEvent[] = []
    let resolve: (() => void) | null = null
    let done = false
    let awaitingInput = false

    const push = (e: AgentEvent) => {
      queue.push(e)
      resolve?.()
      resolve = null
    }

    console.log(
      "[Codebuff] Starting run",
      previousRun ? "(continuation)" : "",
      "prompt:",
      prompt.slice(0, 500)
    )

    const runPromise = this.client
      .run({
        agent: AGENT,
        prompt,
        previousRun,
        extraToolResults: extraToolResults as Parameters<typeof this.client.run>[0]["extraToolResults"],
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
            const toolCallId = e.toolCallId as string
            const input = e.input as Record<string, unknown>

            // Skip internal control flow tools - they're handled by the SDK
            if (toolName === "end_turn" || toolName === "task_completed") {
              return
            }

            // Check if this is a human-in-the-loop tool
            const isHumanInTheLoop = HUMAN_IN_THE_LOOP_TOOLS.includes(
              toolName as (typeof HUMAN_IN_THE_LOOP_TOOLS)[number]
            )

            if (isHumanInTheLoop) {
              // Store pending tool call for continuation
              this.pendingToolCall = { toolCallId, toolName, input }
              awaitingInput = true

              push({
                type: "tool_use",
                tool: {
                  id: toolCallId,
                  name: toolName,
                  input,
                  status: "awaiting_input",
                },
                awaitingInput: true,
              })
            } else {
              push({
                type: "tool_use",
                tool: {
                  id: toolCallId,
                  name: toolName,
                  input,
                  status: options.autoApprove ? "running" : "pending",
                },
              })
            }
          } else if (e.type === "tool_result") {
            push({
              type: "tool_result",
              toolId: e.toolCallId as string,
              result: JSON.stringify(e.output),
            })
          }
        },
      })
      .catch((err) => {
        push({ type: "error", error: err.message })
      })
      .finally(() => {
        done = true
        resolve?.()
      })

    while (!done || queue.length > 0) {
      while (queue.length > 0) yield queue.shift()!
      if (!done) await new Promise<void>((r) => (resolve = r))
    }

    // Store the run state for potential continuation
    const runState = await runPromise
    if (runState) {
      this.lastRunState = runState
    }

    // If awaiting input, signal that we're paused (don't emit "done")
    if (awaitingInput) {
      console.log("[Codebuff] Paused - awaiting user input for tool:", this.pendingToolCall?.toolName)
      return
    }

    yield { type: "done" }
  }

  abort(): void {
    this.abortController?.abort()
    this.pendingToolCall = null
  }
}
