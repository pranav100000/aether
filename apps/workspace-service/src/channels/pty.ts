import { spawn, type IPty, type IExitEvent } from "bun-pty"
import { logger } from "../logging"
import type { TerminalInputMessage, TerminalResizeMessage, TerminalOutputMessage } from "./types"

export interface PTYHandlerConfig {
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export class PTYHandler {
  private ptyProcess: IPty | null = null
  private sendFn: ((msg: TerminalOutputMessage) => void) | null = null
  private log = logger.child({ channel: "pty" })

  constructor(private config: PTYHandlerConfig) {}

  /**
   * Initialize PTY and start shell
   */
  initialize(send: (msg: TerminalOutputMessage) => void): void {
    this.sendFn = send

    const shell = Bun.env.SHELL || "bash"

    this.ptyProcess = spawn(shell, [], {
      name: "xterm-256color",
      cols: this.config.cols || 80,
      rows: this.config.rows || 24,
      cwd: this.config.cwd,
      env: {
        ...Bun.env,
        ...this.config.env,
        TERM: "xterm-256color",
      } as Record<string, string>,
    })

    // Forward PTY output to WebSocket
    this.ptyProcess.onData((data: string) => {
      this.send(data)
    })

    this.ptyProcess.onExit(({ exitCode, signal }: IExitEvent) => {
      this.log.info("shell exited", { exit_code: exitCode, signal })
    })

    this.log.info("started shell", { shell, cwd: this.config.cwd })
  }

  /**
   * Handle incoming terminal message
   */
  handleMessage(msg: TerminalInputMessage | TerminalResizeMessage): void {
    if (!this.ptyProcess) {
      this.log.error("not initialized")
      return
    }

    switch (msg.type) {
      case "input":
        this.ptyProcess.write(msg.data)
        break

      case "resize":
        this.ptyProcess.resize(msg.cols, msg.rows)
        this.log.debug("resized", { cols: msg.cols, rows: msg.rows })
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
      this.log.info("closed")
    }
  }
}
