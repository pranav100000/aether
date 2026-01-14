import { readFile } from "fs/promises"
import type { PortChangeMessage } from "./types"

export interface PortWatcherConfig {
  pollIntervalMs?: number
  ignorePorts?: number[]
}

export class PortWatcher {
  private sendFn: ((msg: PortChangeMessage) => void) | null = null
  private pollInterval: NodeJS.Timeout | null = null
  private knownPorts: Set<number> = new Set()
  private config: PortWatcherConfig

  constructor(config: PortWatcherConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      ignorePorts: config.ignorePorts ?? [22, 2222, 3001], // SSH and workspace service ports
    }
  }

  /**
   * Initialize port watcher and start polling
   */
  initialize(send: (msg: PortChangeMessage) => void): void {
    this.sendFn = send

    // Initial scan
    this.scanPorts()

    // Start polling
    this.pollInterval = setInterval(() => {
      this.scanPorts()
    }, this.config.pollIntervalMs)

    console.log(`[PortWatcher] Started, polling every ${this.config.pollIntervalMs}ms`)
  }

  /**
   * Scan for listening TCP ports
   */
  private async scanPorts(): Promise<void> {
    try {
      const currentPorts = await this.getListeningPorts()

      // Find new ports (opened)
      for (const port of currentPorts) {
        if (!this.knownPorts.has(port)) {
          this.knownPorts.add(port)
          this.send(port, "open")
        }
      }

      // Find removed ports (closed)
      for (const port of this.knownPorts) {
        if (!currentPorts.has(port)) {
          this.knownPorts.delete(port)
          this.send(port, "close")
        }
      }
    } catch (err) {
      console.error("[PortWatcher] Error scanning ports:", err)
    }
  }

  /**
   * Get currently listening TCP ports by reading /proc/net/tcp
   */
  private async getListeningPorts(): Promise<Set<number>> {
    const ports = new Set<number>()

    try {
      // Read IPv4 TCP connections
      const tcp4 = await this.readProcNetTcp("/proc/net/tcp")
      for (const port of tcp4) {
        ports.add(port)
      }
    } catch {
      // /proc/net/tcp might not exist (non-Linux)
    }

    try {
      // Read IPv6 TCP connections
      const tcp6 = await this.readProcNetTcp("/proc/net/tcp6")
      for (const port of tcp6) {
        ports.add(port)
      }
    } catch {
      // /proc/net/tcp6 might not exist
    }

    // Filter out ignored ports
    const ignorePorts = this.config.ignorePorts ?? []
    for (const port of ignorePorts) {
      ports.delete(port)
    }

    return ports
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
    const content = await readFile(path, "utf-8")
    const lines = content.trim().split("\n")
    const ports: number[] = []

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      const parts = line.split(/\s+/)

      if (parts.length < 4) continue

      const localAddress = parts[1]
      const state = parts[3]

      // Only interested in LISTEN state (0A)
      if (state !== "0A") continue

      // Parse port from local_address (format: ADDR:PORT in hex)
      const colonIndex = localAddress.lastIndexOf(":")
      if (colonIndex === -1) continue

      const portHex = localAddress.substring(colonIndex + 1)
      const port = parseInt(portHex, 16)

      if (!isNaN(port) && port > 0) {
        ports.push(port)
      }
    }

    return ports
  }

  /**
   * Send port change message
   */
  private send(port: number, action: "open" | "close"): void {
    console.log(`[PortWatcher] Port ${port} ${action}ed`)
    this.sendFn?.({
      channel: "ports",
      type: "change",
      action,
      port,
    })
  }

  /**
   * Close the watcher
   */
  close(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.knownPorts.clear()
    console.log("[PortWatcher] Closed")
  }
}
