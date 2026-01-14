import type { PortChangeMessage } from "./types"

export interface PortWatcherConfig {
  pollIntervalMs?: number
  ignorePorts?: number[]
}

export class PortWatcher {
  private sendFn: ((msg: PortChangeMessage) => void) | null = null
  private pollInterval: Timer | null = null
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

    // Initial scan - emit all existing ports as "open"
    this.getListeningPorts().then((ports) => {
      for (const port of ports) {
        this.knownPorts.add(port)
        this.send(port, "open")
      }
      console.log(`[PortWatcher] Started, found ${ports.size} ports, polling every ${this.config.pollIntervalMs}ms`)
    })

    // Start polling
    this.pollInterval = setInterval(() => {
      this.scanPorts()
    }, this.config.pollIntervalMs)
  }

  /**
   * Get currently known ports (useful for reconnection)
   */
  getCurrentPorts(): number[] {
    return [...this.knownPorts]
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
    // Read IPv4 and IPv6 in parallel
    const [tcp4, tcp6] = await Promise.all([
      this.readProcNetTcp("/proc/net/tcp").catch(() => []),
      this.readProcNetTcp("/proc/net/tcp6").catch(() => []),
    ])

    const ports = new Set<number>([...tcp4, ...tcp6])

    // Filter out ignored ports
    for (const port of this.config.ignorePorts ?? []) {
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
    const content = await Bun.file(path).text()
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
