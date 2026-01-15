/**
 * VMConnector is a transport-agnostic interface for receiving connections
 * from the Go backend proxy. It handles raw messages without knowledge of
 * message types - allowing the same transport to carry agent messages,
 * file updates, and any future message types.
 */
export interface VMConnector {
  /**
   * Initialize the connector with configuration
   */
  initialize(config: VMConnectorConfig): Promise<void>;

  /**
   * Send raw message to the proxy (will be JSON stringified if object)
   */
  send(data: unknown): void;

  /**
   * Register handler for incoming raw messages
   * @param handler - Called with parsed JSON for each message received
   */
  onMessage(handler: (data: unknown) => Promise<void>): void;

  /**
   * Register handler for connection close events
   */
  onClose(handler: () => void): void;

  /**
   * Close the connection
   */
  close(): void;
}

/**
 * Configuration for VMConnector initialization
 */
export interface VMConnectorConfig {
  /**
   * Agent type (claude, codex, codebuff, opencode)
   */
  agentType: string;

  /**
   * Environment variables passed from the proxy
   */
  environment?: Record<string, string>;
}
