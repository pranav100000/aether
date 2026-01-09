import type { AgentProvider, AgentConfig, AgentMessage } from "../types";

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const;
  private currentProc?: ReturnType<typeof Bun.spawn>;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async *query(
    prompt: string,
    config: AgentConfig
  ): AsyncIterable<AgentMessage> {
    // Run claude CLI with streaming JSON output mode
    const args = [
      "claude",
      "--print", // Non-interactive mode
      "--output-format", "stream-json", // Streaming JSON for real-time output
      "--verbose", // Required for stream-json with --print
      "--include-partial-messages", // Stream individual text tokens
    ];

    if (config.autoApprove) {
      args.push("--dangerously-skip-permissions");
    }

    // Add the prompt
    args.push(prompt);

    const proc = Bun.spawn(args, {
      cwd: config.cwd,
      env: {
        ...process.env,
        // Ensure the CLI uses the API key from environment
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.currentProc = proc;

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track current tool being built (for accumulating input)
    const toolState = {
      id: null as string | null,
      name: null as string | null,
      input: "",
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse JSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const msg = JSON.parse(line);
            const mapped = this.mapStreamMessage(msg, config, toolState);
            if (mapped) {
              yield mapped;
            }
          } catch {
            // If not JSON, treat as plain text output
            yield { type: "text", content: line, streaming: true };
          }
        }
      }

      // Handle remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer);
          const mapped = this.mapStreamMessage(msg, config, toolState);
          if (mapped) {
            yield mapped;
          }
        } catch {
          yield { type: "text", content: buffer, streaming: true };
        }
      }

      // Wait for process to complete
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // Read stderr for error message
        const stderrReader = proc.stderr.getReader();
        let stderr = "";
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          stderr += decoder.decode(value, { stream: true });
        }

        if (stderr.trim()) {
          yield { type: "error", error: stderr.trim() };
        }
      }

      yield { type: "done" };
    } finally {
      reader.releaseLock();
      this.currentProc = undefined;
    }
  }

  private mapStreamMessage(
    msg: Record<string, unknown>,
    config: AgentConfig,
    toolState: {
      id: string | null;
      name: string | null;
      input: string;
    }
  ): AgentMessage | null {
    const type = msg.type as string;

    // Handle stream_event messages (from --include-partial-messages)
    if (type === "stream_event") {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) return null;

      const eventType = event.type as string;

      // content_block_start - start of a text or tool_use block
      if (eventType === "content_block_start") {
        const contentBlock = event.content_block as Record<string, unknown> | undefined;
        if (contentBlock?.type === "tool_use") {
          // Start tracking tool - don't emit yet, wait for input
          toolState.id = contentBlock.id as string;
          toolState.name = contentBlock.name as string;
          toolState.input = "";
        }
        return null;
      }

      // content_block_delta - streaming content (text or tool input)
      if (eventType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && delta.text) {
          return {
            type: "text",
            content: delta.text as string,
            streaming: true,
          };
        }
        if (delta?.type === "input_json_delta" && delta.partial_json) {
          // Accumulate tool input JSON
          toolState.input += delta.partial_json as string;
        }
        return null;
      }

      // content_block_stop - end of content block, emit complete tool if we have one
      if (eventType === "content_block_stop") {
        if (toolState.id && toolState.name) {
          // Parse accumulated JSON input
          let parsedInput: Record<string, unknown> = {};
          if (toolState.input) {
            try {
              parsedInput = JSON.parse(toolState.input);
            } catch {
              // If parsing fails, keep as empty object
            }
          }

          const result: AgentMessage = {
            type: "tool_use",
            tool: {
              id: toolState.id,
              name: toolState.name,
              input: parsedInput,
              status: config.autoApprove ? "running" : "pending",
            },
          };

          // Reset tool state
          toolState.id = null;
          toolState.name = null;
          toolState.input = "";

          return result;
        }
        return null;
      }

      // message_stop - end of message
      if (eventType === "message_stop") {
        // Reset any pending tool state
        toolState.id = null;
        toolState.name = null;
        toolState.input = "";
        return null;
      }

      return null;
    }

    // Handle direct content_block types (fallback for non-stream_event format)
    if (type === "content_block_start") {
      const contentBlock = msg.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "tool_use") {
        toolState.id = contentBlock.id as string;
        toolState.name = contentBlock.name as string;
        toolState.input = "";
      }
      return null;
    }

    if (type === "content_block_delta") {
      const delta = msg.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        return {
          type: "text",
          content: delta.text as string,
          streaming: true,
        };
      }
      if (delta?.type === "input_json_delta" && delta.partial_json) {
        toolState.input += delta.partial_json as string;
      }
      return null;
    }

    if (type === "content_block_stop") {
      if (toolState.id && toolState.name) {
        let parsedInput: Record<string, unknown> = {};
        if (toolState.input) {
          try {
            parsedInput = JSON.parse(toolState.input);
          } catch {
            // Keep as empty object
          }
        }

        const result: AgentMessage = {
          type: "tool_use",
          tool: {
            id: toolState.id,
            name: toolState.name,
            input: parsedInput,
            status: config.autoApprove ? "running" : "pending",
          },
        };

        toolState.id = null;
        toolState.name = null;
        toolState.input = "";

        return result;
      }
      return null;
    }

    if (type === "message_stop") {
      toolState.id = null;
      toolState.name = null;
      toolState.input = "";
      return null;
    }

    // Skip system init messages
    if (type === "system") {
      return null;
    }

    // Skip user messages (tool results echoed back)
    if (type === "user") {
      return null;
    }

    // Handle legacy/fallback message types
    if (type === "text" || type === "message") {
      return {
        type: "text",
        content: (msg.content || msg.text) as string,
        streaming: true,
      };
    }

    // Handle assistant messages - skip since we get content via stream_event
    if (type === "assistant") {
      return null;
    }

    // Direct tool_use message (non-streaming fallback)
    if (type === "tool_use") {
      return {
        type: "tool_use",
        tool: {
          id: msg.id as string,
          name: msg.name as string,
          input: msg.input as Record<string, unknown>,
          status: config.autoApprove ? "running" : "pending",
        },
      };
    }

    if (type === "tool_result") {
      return {
        type: "tool_result",
        toolId: msg.tool_use_id as string,
        result: String(msg.content),
      };
    }

    // Final result message - skip since we already streamed the content
    if (type === "result") {
      return null;
    }

    if (type === "error") {
      return {
        type: "error",
        error:
          (msg.error as { message?: string })?.message ||
          (msg.message as string) ||
          String(msg.error || msg),
      };
    }

    return null;
  }

  abort(): void {
    this.currentProc?.kill();
  }
}
