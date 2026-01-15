import { CodebuffClient, type RunState } from "@codebuff/sdk";
import type {
  AgentProvider,
  AgentEvent,
  QueryOptions,
  ProviderConfig,
  ToolResponsePayload,
} from "../types";

const AGENT = "codebuff/base2-max@0.0.24";

interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (response: unknown[]) => void;
  reject: (error: Error) => void;
}

export class CodebuffProvider implements AgentProvider {
  readonly name = "codebuff" as const;
  private client: CodebuffClient;
  private abortController: AbortController | null = null;
  private lastRunState: RunState | null = null;
  private pendingToolCall: PendingToolCall | null = null;
  private eventQueue: AgentEvent[] = [];
  private eventResolve: (() => void) | null = null;

  constructor(config: ProviderConfig) {
    this.client = new CodebuffClient({ apiKey: Bun.env.CODEBUFF_API_KEY!, cwd: config.cwd });
  }

  isConfigured(): boolean {
    return !!Bun.env.CODEBUFF_API_KEY && !!Bun.env.CODEBUFF_BYOK_OPENROUTER;
  }

  hasPendingRun(): boolean {
    return this.pendingToolCall !== null;
  }

  async *query(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    // Clear any previous pending state when starting a new query
    this.pendingToolCall = null;
    yield* this.runAgent(prompt, options);
  }

  async *continueWithToolResponse(
    toolResponse: ToolResponsePayload,
    _options: QueryOptions
  ): AsyncIterable<AgentEvent> {
    console.log("[Codebuff] ========================================");
    console.log("[Codebuff] continueWithToolResponse CALLED");
    console.log("[Codebuff] Tool response:", JSON.stringify(toolResponse, null, 2));
    console.log("[Codebuff] ========================================");

    if (!this.pendingToolCall) {
      console.log("[Codebuff] ERROR: No pending tool call!");
      yield { type: "error", error: "No pending tool call to continue" };
      return;
    }

    if (toolResponse.toolId !== this.pendingToolCall.toolCallId) {
      console.log("[Codebuff] ERROR: Tool ID mismatch!");
      console.log("[Codebuff] Expected:", this.pendingToolCall.toolCallId);
      console.log("[Codebuff] Got:", toolResponse.toolId);
      yield {
        type: "error",
        error: `Tool ID mismatch: expected ${this.pendingToolCall.toolCallId}, got ${toolResponse.toolId}`,
      };
      return;
    }

    // Format and resolve the pending Promise - this unblocks the SDK
    const formattedResponse = this.formatToolResponse(toolResponse);
    console.log("[Codebuff] Formatted response:", JSON.stringify(formattedResponse, null, 2));
    console.log("[Codebuff] Resolving pending Promise to unblock SDK...");
    this.pendingToolCall.resolve(formattedResponse);
    this.pendingToolCall = null;

    console.log("[Codebuff] Promise resolved, now yielding events from queue...");

    // The SDK will continue automatically after we resolve
    // We just need to keep yielding events from the queue
    while (true) {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        console.log("[Codebuff] Yielding event:", event.type);
        yield event;
        if (event.type === "done" || event.type === "error") {
          return;
        }
      }
      // Wait for more events
      await new Promise<void>((r) => (this.eventResolve = r));
    }
  }

  private formatToolResponse(toolResponse: ToolResponsePayload): unknown[] {
    // Format ask_user response according to the SDK's expected output schema
    if (toolResponse.toolName === "ask_user" && this.pendingToolCall) {
      const response = toolResponse.response as {
        answers: Record<number, number[]>;
        customAnswers?: Record<number, string>;
      };

      // Get the original questions from the pending tool call input
      const input = this.pendingToolCall.input as {
        questions: Array<{
          question: string;
          options: Array<{ label: string; description?: string }>;
          multiSelect?: boolean;
        }>;
      };

      // Build the response in the format the SDK expects:
      // [{ type: "json", value: { answers: [{ questionIndex, selectedOption/selectedOptions, otherText }] } }]
      const formattedAnswers: Array<{
        questionIndex: number;
        selectedOption?: string;
        selectedOptions?: string[];
        otherText?: string;
      }> = [];

      for (const [questionIdxStr, selectedIndices] of Object.entries(response.answers)) {
        const questionIndex = Number(questionIdxStr);
        const question = input.questions[questionIndex];
        const customAnswer = response.customAnswers?.[questionIndex];

        // Filter out -1 (which represents "Other" selection)
        const regularIndices = selectedIndices.filter((idx) => idx >= 0);

        if (customAnswer) {
          // User selected "Other" and provided custom text
          formattedAnswers.push({
            questionIndex,
            otherText: customAnswer,
          });
        } else if (question?.multiSelect || regularIndices.length > 1) {
          // Multi-select: map indices to option labels
          const selectedOptions = regularIndices
            .map((idx) => question?.options[idx]?.label)
            .filter((label): label is string => !!label);
          formattedAnswers.push({
            questionIndex,
            selectedOptions,
          });
        } else if (regularIndices.length === 1) {
          // Single select: get the option label
          const selectedOption = question?.options[regularIndices[0]]?.label;
          if (selectedOption) {
            formattedAnswers.push({
              questionIndex,
              selectedOption,
            });
          }
        }
      }

      return [{ type: "json", value: { answers: formattedAnswers } }];
    }

    // Default: wrap the response as JSON
    return [{ type: "json", value: toolResponse.response }];
  }

  private pushEvent(event: AgentEvent) {
    this.eventQueue.push(event);
    this.eventResolve?.();
    this.eventResolve = null;
  }

  private async *runAgent(prompt: string, options: QueryOptions): AsyncIterable<AgentEvent> {
    this.abortController = new AbortController();
    this.eventQueue = [];
    let runDone = false;

    console.log("[Codebuff] Starting run, prompt:", prompt.slice(0, 500));

    // Start the run in background (fire-and-forget, results come through event queue)
    this.client
      .run({
        agent: AGENT,
        prompt,
        signal: this.abortController.signal,
        // Override ask_user to wait for user input
        overrideTools: {
          ask_user: async (input) => {
            console.log("[Codebuff] ========================================");
            console.log("[Codebuff] ask_user OVERRIDE INVOKED");
            console.log("[Codebuff] Input:", JSON.stringify(input, null, 2));
            console.log("[Codebuff] ========================================");

            // Generate a unique tool call ID
            const toolCallId = `ask_user_${Date.now()}`;

            // Emit the tool_use event with awaiting_input status
            this.pushEvent({
              type: "tool_use",
              tool: {
                id: toolCallId,
                name: "ask_user",
                input: input as Record<string, unknown>,
                status: "awaiting_input",
              },
              awaitingInput: true,
            });

            console.log("[Codebuff] Pushed awaiting_input event, now blocking...");

            // Create and await a Promise that will be resolved when user responds
            // The SDK MUST wait for this Promise to resolve before continuing
            type AskUserOutput = [
              {
                type: "json";
                value: {
                  answers?: Array<{
                    questionIndex: number;
                    selectedOption?: string;
                    selectedOptions?: string[];
                    otherText?: string;
                  }>;
                  skipped?: boolean;
                };
              },
            ];

            const result = await new Promise<AskUserOutput>((resolve, reject) => {
              this.pendingToolCall = {
                toolCallId,
                toolName: "ask_user",
                input: input as Record<string, unknown>,
                resolve: resolve as (response: unknown[]) => void,
                reject,
              };
              console.log(
                "[Codebuff] Promise created - SDK is now BLOCKED waiting for user response"
              );
              console.log("[Codebuff] Tool call ID:", toolCallId);
            });

            console.log("[Codebuff] ========================================");
            console.log("[Codebuff] ask_user Promise RESOLVED");
            console.log("[Codebuff] Result:", JSON.stringify(result, null, 2));
            console.log("[Codebuff] ========================================");

            return result;
          },
        },
        handleStreamChunk: (chunk) => {
          if (typeof chunk === "string") {
            this.pushEvent({ type: "text", content: chunk, streaming: true });
          }
        },
        handleEvent: (e) => {
          const toolName = (e as { toolName?: string }).toolName;
          console.log("[Codebuff] handleEvent:", e.type, toolName || "", e);

          if (e.type === "tool_call") {
            const callToolName = e.toolName as string;
            const toolCallId = e.toolCallId as string;
            const input = e.input as Record<string, unknown>;

            // Log ask_user specifically
            if (callToolName === "ask_user") {
              console.log(
                "[Codebuff] handleEvent received ask_user tool_call (should be handled by overrideTools)"
              );
              return;
            }

            // Skip internal control flow tools
            if (callToolName === "end_turn" || callToolName === "task_completed") {
              return;
            }

            this.pushEvent({
              type: "tool_use",
              tool: {
                id: toolCallId,
                name: callToolName,
                input,
                status: options.autoApprove ? "running" : "pending",
              },
            });
          } else if (e.type === "tool_result") {
            // Log ask_user results specifically
            if (toolName === "ask_user") {
              console.log("[Codebuff] handleEvent received ask_user tool_result:", e);
              return;
            }
            this.pushEvent({
              type: "tool_result",
              toolId: e.toolCallId as string,
              result: JSON.stringify(e.output),
            });
          }
        },
      })
      .then((state) => {
        console.log("[Codebuff] ========================================");
        console.log("[Codebuff] RUN COMPLETED SUCCESSFULLY");
        console.log("[Codebuff] State output:", state.output);
        console.log("[Codebuff] ========================================");
        this.lastRunState = state;
        runDone = true;
        this.pushEvent({ type: "done" });
      })
      .catch((err) => {
        console.log("[Codebuff] ========================================");
        console.log("[Codebuff] RUN FAILED");
        console.log("[Codebuff] Error:", err.message);
        console.log("[Codebuff] ========================================");
        runDone = true;
        // If we have a pending tool call, reject it
        if (this.pendingToolCall) {
          this.pendingToolCall.reject(err);
          this.pendingToolCall = null;
        }
        this.pushEvent({ type: "error", error: err.message });
      });

    // Yield events as they come in
    while (true) {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        yield event;

        // If we're awaiting input, pause here - don't yield done yet
        if (event.awaitingInput) {
          console.log("[Codebuff] Pausing - awaiting user input");
          return; // Exit the generator, waiting for continueWithToolResponse
        }

        if (event.type === "done" || event.type === "error") {
          return;
        }
      }

      // If run is done and queue is empty, we're finished
      if (runDone && this.eventQueue.length === 0) {
        return;
      }

      // Wait for more events
      await new Promise<void>((r) => (this.eventResolve = r));
    }
  }

  abort(): void {
    this.abortController?.abort();
    if (this.pendingToolCall) {
      this.pendingToolCall.reject(new Error("Aborted"));
      this.pendingToolCall = null;
    }
  }
}
