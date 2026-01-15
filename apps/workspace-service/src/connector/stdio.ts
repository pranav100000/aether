import type { VMConnector, VMConnectorConfig } from "./types";

/**
 * StdioConnector implements VMConnector using stdin/stdout.
 * Used when the agent is started via SSH and communicates via pipes.
 */
export class StdioConnector implements VMConnector {
  private config: VMConnectorConfig | null = null;
  private messageHandler: ((data: unknown) => Promise<void>) | null = null;
  private closeHandler: (() => void) | null = null;
  private running = false;

  async initialize(config: VMConnectorConfig): Promise<void> {
    this.config = config;
    this.running = true;

    // Start reading from stdin
    this.readLoop();
  }

  send(data: unknown): void {
    // Add agent type to messages for routing
    const message =
      typeof data === "object" && data !== null ? { ...data, agent: this.config?.agentType } : data;

    console.log(JSON.stringify(message));
  }

  onMessage(handler: (data: unknown) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.running = false;
    this.closeHandler?.();
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for await (const chunk of Bun.stdin.stream()) {
        if (!this.running) break;

        buffer += decoder.decode(chunk);

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const msg = JSON.parse(line);
            await this.messageHandler?.(msg);
          } catch (err) {
            this.send({ type: "error", error: `Parse error: ${String(err)}` });
          }
        }
      }
    } catch (err) {
      this.send({ type: "error", error: `Stdin error: ${String(err)}` });
    } finally {
      this.close();
    }
  }
}
