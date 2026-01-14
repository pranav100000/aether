import { spawn, type Pty } from "bun-pty"
import type { TerminalInputMessage, TerminalResizeMessage, TerminalOutputMessage } from "./types"

export interface PTYHandlerConfig {
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export class PTYHandler {
  private ptyProcess: Pty | null = null
  private sendFn: ((msg: TerminalOutputMessage) => void) | null = null

  constructor(private config: PTYHandlerConfig) {}

  /**
   * Initialize PTY and start shell
   */
  initialize(send: (msg: TerminalOutputMessage) => void): void {
    this.sendFn = send

    const shell = process.env.SHELL || "bash"

    this.ptyProcess = spawn(shell, [], {
      name: "xterm-256color",
      cols: this.config.cols || 80,
      rows: this.config.rows || 24,
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env,
        TERM: "xterm-256color",
      } as Record<string, string>,
    })

    // Forward PTY output to WebSocket
    this.ptyProcess.onData((data) => {
      this.send(data)
    })

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[PTY] Shell exited with code ${exitCode}, signal ${signal}`)
      // Could send a special message here if needed
    })

    console.log(`[PTY] Started shell: ${shell} in ${this.config.cwd}`)
  }

  /**
   * Handle incoming terminal message
   */
  handleMessage(msg: TerminalInputMessage | TerminalResizeMessage): void {
    if (!this.ptyProcess) {
      console.error("[PTY] Not initialized")
      return
    }

    switch (msg.type) {
      case "input":
        this.ptyProcess.write(msg.data)
        break

      case "resize":
        this.ptyProcess.resize(msg.cols, msg.rows)
        console.log(`[PTY] Resized to ${msg.cols}x${msg.rows}`)
        break
    }
  }

  /**
   * Send output to client
   */
  private send(data: string): void {
    this.sendFn?.({
      channel: "terminal",
      type: "output",
      data,
    })
  }

  /**
   * Close PTY
   */
  close(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = null
      console.log("[PTY] Closed")
    }
  }
}
