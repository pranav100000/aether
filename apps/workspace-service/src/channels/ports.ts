import { spawn, type Subprocess } from "bun";
import { logger } from "../logging";
import type { PortChangeMessage } from "./types";

export interface PortWatcherConfig {
  pollIntervalMs?: number;
  ignorePorts?: number[];
}

export class PortWatcher {
  private sendFn: ((msg: PortChangeMessage) => void) | null = null;
  private pollInterval: Timer | null = null;
  private knownPorts: Set<number> = new Set();
  private forwarders: Map<number, Subprocess> = new Map();
  private config: PortWatcherConfig;
  private log = logger.child({ channel: "ports" });
  private isLocalMode = Bun.env.LOCAL_MODE === "true";

  constructor(config: PortWatcherConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      ignorePorts: config.ignorePorts ?? [22, 2222, 3001], // SSH and workspace service ports
    };
  }

  /**
   * Initialize port watcher and start polling
   */
  initialize(send: (msg: PortChangeMessage) => void): void {
    this.sendFn = send;

    // Initial scan - emit all existing ports as "open"
    this.getListeningPorts()
      .then((ports) => {
        for (const port of ports) {
          this.knownPorts.add(port);
          this.startForwarder(port);
          this.send(port, "open");
        }
        this.log.info("started", {
          initial_ports: ports.size,
          poll_interval_ms: this.config.pollIntervalMs,
        });
      })
      .catch((err) => {
        this.log.error("failed initial port scan", { error: String(err) });
      });

    // Start polling
    this.pollInterval = setInterval(() => {
      this.scanPorts();
    }, this.config.pollIntervalMs);
  }

  /**
   * Get currently known ports (useful for reconnection)
   */
  getCurrentPorts(): number[] {
    return [...this.knownPorts];
  }

  /**
   * Scan for listening TCP ports
   */
  private async scanPorts(): Promise<void> {
    try {
      const currentPorts = await this.getListeningPorts();

      // Find new ports (opened)
      for (const port of currentPorts) {
        if (!this.knownPorts.has(port)) {
          this.knownPorts.add(port);
          this.startForwarder(port);
          this.send(port, "open");
        }
      }

      // Find removed ports (closed)
      for (const port of this.knownPorts) {
        if (!currentPorts.has(port)) {
          this.knownPorts.delete(port);
          this.stopForwarder(port);
          this.send(port, "close");
        }
      }
    } catch (err) {
      this.log.error("error scanning ports", { error: String(err) });
    }
  }

  /**
   * Get currently listening TCP ports by reading /proc/net/tcp (IPv4 only).
   * User dev servers bind to IPv4 (localhost or 0.0.0.0).
   * We ignore IPv6 to avoid detecting our own socat forwarders.
   */
  private async getListeningPorts(): Promise<Set<number>> {
    const ports = await this.readProcNetTcp("/proc/net/tcp").catch(() => []);
    const portSet = new Set<number>(ports);

    // Filter out ignored ports
    for (const port of this.config.ignorePorts ?? []) {
      portSet.delete(port);
    }

    return portSet;
  }

  /**
   * Parse /proc/net/tcp format to extract listening ports
   *
   * Format:
   *   sl  local_address rem_address   st tx_queue rx_queue ...
   *    0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 ...
   *
   * local_address is hex IP:PORT, st is state (0A = LISTEN)
   */
  private async readProcNetTcp(path: string): Promise<number[]> {
    const content = await Bun.file(path).text();
    const lines = content.trim().split("\n");
    const ports: number[] = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(/\s+/);

      if (parts.length < 4) continue;

      const localAddress = parts[1];
      const state = parts[3];

      // Only interested in LISTEN state (0A)
      if (state !== "0A") continue;

      // Parse port from local_address (format: ADDR:PORT in hex)
      const colonIndex = localAddress.lastIndexOf(":");
      if (colonIndex === -1) continue;

      const portHex = localAddress.substring(colonIndex + 1);
      const port = parseInt(portHex, 16);

      if (!isNaN(port) && port > 0) {
        ports.push(port);
      }
    }

    return ports;
  }

  /**
   * Start a forwarder for external access to the port.
   * - Production (Fly.io): IPv6 → IPv4 localhost (gateway connects via IPv6)
   * - Local (Docker): 0.0.0.0 → 127.0.0.1 (Docker needs 0.0.0.0 binding)
   */
  private startForwarder(port: number): void {
    if (this.forwarders.has(port)) return;

    try {
      const cmd = this.isLocalMode
        ? ["socat", `TCP-LISTEN:${port},fork,reuseaddr,bind=0.0.0.0`, `TCP:127.0.0.1:${port}`]
        : ["socat", `TCP6-LISTEN:${port},fork,reuseaddr,ipv6-v6only`, `TCP4:127.0.0.1:${port}`];

      const proc = spawn({
        cmd,
        stdout: "pipe",
        stderr: "pipe",
      });
      this.forwarders.set(port, proc);
      this.log.debug("started forwarder", { port, pid: proc.pid, local_mode: this.isLocalMode });
    } catch (err) {
      this.log.error("failed to start forwarder", { port, error: String(err) });
    }
  }

  /**
   * Stop the forwarder for a port
   */
  private stopForwarder(port: number): void {
    const proc = this.forwarders.get(port);
    if (!proc) return;

    try {
      proc.kill();
      this.forwarders.delete(port);
      this.log.debug("stopped forwarder", { port });
    } catch (err) {
      this.log.error("failed to stop forwarder", { port, error: String(err) });
    }
  }

  /**
   * Send port change message
   */
  private send(port: number, action: "open" | "close"): void {
    this.log.debug("port change", { port, action });
    this.sendFn?.({
      channel: "ports",
      type: "change",
      action,
      port,
    });
  }

  /**
   * Close the watcher and all forwarders
   */
  close(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Kill all forwarders
    for (const [port, proc] of this.forwarders) {
      try {
        proc.kill();
        this.log.debug("stopped forwarder on close", { port });
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.forwarders.clear();
    this.knownPorts.clear();
    this.log.info("closed");
  }
}
