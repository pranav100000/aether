import { CodebuffClient } from "@codebuff/sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "../types";
import { buildFullPrompt } from "../utils/context";

type RunState = Awaited<ReturnType<CodebuffClient["run"]>>;

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const;
  private client: CodebuffClient | null = null;
  private previousRun: RunState | null = null;

  isConfigured(): boolean {
    // CodeBuff requires both: CODEBUFF_API_KEY (service auth) and CODEBUFF_BYOK_OPENROUTER (model provider)
    return !!process.env.CODEBUFF_API_KEY && !!process.env.CODEBUFF_BYOK_OPENROUTER;
  }

  private getClient(cwd: string): CodebuffClient {
    if (!this.client) {
      this.client = new CodebuffClient({
        apiKey: process.env.CODEBUFF_API_KEY!,
        cwd,
      });
    }
    return this.client;
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    const client = this.getClient(config.cwd);

    // Build prompt with file context and conversation history
    const fullPrompt = buildFullPrompt(
      prompt,
      config.fileContext,
      config.conversationHistory,
      "markdown"
    );

    // Create a channel to stream events from callback to async iterator
    const eventQueue: AgentMessage[] = [];
    let resolveWait: (() => void) | null = null;
    let isComplete = false;

    const handleEvent = (event: { type: string; [key: string]: unknown }) => {
      const mapped = this.mapEvent(event, config);
      if (mapped) {
        eventQueue.push(mapped);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      }
    };

    // Start the run in the background
    const runPromise = client
      .run({
        agent: config.model || "base2",
        prompt: fullPrompt,
        handleEvent,
        ...(this.previousRun ? { previousRun: this.previousRun } : {}),
      })
      .then((result: RunState) => {
        this.previousRun = result;
        isComplete = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
        return result;
      })
      .catch((err: Error) => {
        eventQueue.push({
          type: "error",
          error: err.message,
        });
        isComplete = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
        throw err;
      });

    // Yield events as they come in
    while (!isComplete || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      } else if (!isComplete) {
        // Wait for next event
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    }

    // Wait for run to complete
    try {
      await runPromise;
    } catch {
      // Error already pushed to queue
    }

    yield { type: "done" };
  }

  private mapEvent(
    event: { type: string; [key: string]: unknown },
    config: AgentConfig
  ): AgentMessage | null {
    switch (event.type) {
      case "text": {
        const text = event.text as string | undefined;
        if (text) {
          return { type: "text", content: text, streaming: true };
        }
        return null;
      }

      case "tool_call": {
        const toolName = event.toolName as string | undefined;
        const toolCallId = event.toolCallId as string | undefined;
        const input = event.input as Record<string, unknown> | undefined;

        if (toolName) {
          return {
            type: "tool_use",
            tool: {
              id: toolCallId || crypto.randomUUID(),
              name: toolName,
              input: input || {},
              status: config.autoApprove ? "running" : "pending",
            },
          };
        }
        return null;
      }

      case "tool_result": {
        const toolCallId = event.toolCallId as string | undefined;
        const output = event.output as unknown;

        return {
          type: "tool_result",
          toolId: toolCallId,
          result: typeof output === "string" ? output : JSON.stringify(output),
        };
      }

      case "start": {
        // Agent started
        return null;
      }

      case "finish": {
        // Agent completed
        return null;
      }

      case "subagent_start":
      case "subagent_finish": {
        // Subagent lifecycle events
        return null;
      }

      case "error": {
        const message = event.message as string | undefined;
        return {
          type: "error",
          error: message || "Unknown error",
        };
      }

      default:
        return null;
    }
  }

  abort(): void {
    // CodeBuff SDK doesn't expose abort - clear state for next run
    this.previousRun = null;
  }
}
