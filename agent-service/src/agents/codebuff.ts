import { CodebuffClient } from "@codebuff/sdk";
import type { AgentProvider, AgentConfig, AgentMessage } from "../types";

type RunState = Awaited<ReturnType<CodebuffClient["run"]>>;

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const;
  private client: CodebuffClient | null = null;
  private previousRun: RunState | null = null;

  isConfigured(): boolean {
    // CodeBuff uses BYOK (Bring Your Own Key) with OpenRouter
    return !!process.env.CODEBUFF_BYOK_OPENROUTER;
  }

  private getClient(cwd: string): CodebuffClient {
    if (!this.client) {
      this.client = new CodebuffClient({
        apiKey: process.env.CODEBUFF_BYOK_OPENROUTER!,
        cwd,
      });
    }
    return this.client;
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    console.error("[codebuff] Starting query with prompt:", prompt.slice(0, 100));
    console.error("[codebuff] CODEBUFF_BYOK_OPENROUTER set:", !!process.env.CODEBUFF_BYOK_OPENROUTER);

    const client = this.getClient(config.cwd);

    // Build prompt with conversation history if available
    let fullPrompt = prompt;
    if (config.conversationHistory && config.conversationHistory.length > 0) {
      const historyText = config.conversationHistory
        .map(
          (msg) =>
            `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`
        )
        .join("\n\n");
      fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\nHuman: ${prompt}`;
    }

    // Create a channel to stream events from callback to async iterator
    const eventQueue: AgentMessage[] = [];
    let resolveWait: (() => void) | null = null;
    let isComplete = false;

    const handleEvent = (event: { type: string; [key: string]: unknown }) => {
      console.error("[codebuff] Event received:", event.type);
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
    console.error("[codebuff] Starting client.run()");
    const runPromise = client
      .run({
        agent: config.model || "base",
        prompt: fullPrompt,
        handleEvent,
        ...(this.previousRun ? { previousRun: this.previousRun } : {}),
      })
      .then((result: RunState) => {
        console.error("[codebuff] Run completed successfully");
        this.previousRun = result;
        isComplete = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
        return result;
      })
      .catch((err: Error) => {
        console.error("[codebuff] Run failed:", err.message);
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
    console.error("[codebuff] Entering event loop");
    while (!isComplete || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        const msg = eventQueue.shift()!;
        console.error("[codebuff] Yielding message:", msg.type);
        yield msg;
      } else if (!isComplete) {
        // Wait for next event
        console.error("[codebuff] Waiting for next event...");
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    }

    console.error("[codebuff] Event loop complete, waiting for runPromise");
    // Wait for run to complete
    try {
      await runPromise;
    } catch {
      // Error already pushed to queue
    }

    console.error("[codebuff] Yielding done");
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
