/**
 * Client for communicating with the centralized agent-service for LLM calls.
 * This client handles SSE streaming from the agent-service.
 */

export interface StreamEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  content?: string;
  streaming?: boolean;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: string;
  };
  toolId?: string;
  result?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost?: number;
  };
  error?: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  extendedThinking?: boolean;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  fileContext?: Array<{
    path: string;
    content?: string;
    selection?: { startLine: number; endLine: number };
  }>;
}

export class AgentClient {
  private url: string;
  private sessionToken: string;

  constructor() {
    const url = process.env.AGENT_SERVICE_URL;
    const token = process.env.AGENT_SESSION_TOKEN;

    if (!url || !token) {
      throw new Error(
        "AGENT_SERVICE_URL and AGENT_SESSION_TOKEN are required for AgentClient"
      );
    }

    this.url = url;
    this.sessionToken = token;
  }

  /**
   * Check if the agent client is configured (has required env vars)
   */
  static isConfigured(): boolean {
    return !!(process.env.AGENT_SERVICE_URL && process.env.AGENT_SESSION_TOKEN);
  }

  /**
   * Stream a completion from the agent service
   */
  async *completion(
    provider: string,
    model: string,
    prompt: string,
    options?: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.url}/v1/completion`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider,
        model,
        prompt,
        options,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Agent service request failed: ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error("No response body from agent service");
    }

    // Parse SSE stream
    yield* this.parseSSEStream(response.body);
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>
  ): AsyncIterable<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data as StreamEvent;
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6));
          yield data as StreamEvent;
        } catch {
          // Ignore malformed JSON
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
