import * as pty from "node-pty";
import type { ServerWebSocket } from "bun";

const WORKING_DIR = process.env.PROJECT_CWD || "/home/coder/project";

export interface TerminalWSData {
  type: "terminal";
  userId: string;
}

interface TerminalMessage {
  type: "input" | "output" | "resize" | "error" | "exit";
  data?: string;
  cols?: number;
  rows?: number;
  code?: number;
}

interface TerminalSession {
  pty: pty.IPty;
}

const sessions = new Map<ServerWebSocket<TerminalWSData>, TerminalSession>();

export function handleTerminalOpen(ws: ServerWebSocket<TerminalWSData>) {
  const shell = process.env.SHELL || "/bin/bash";

  console.log(`[terminal] Opening PTY with shell: ${shell}, cwd: ${WORKING_DIR}`);

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: WORKING_DIR,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      HOME: process.env.HOME || "/home/coder",
    } as Record<string, string>,
  });

  sessions.set(ws, { pty: ptyProcess });

  ptyProcess.onData((data: string) => {
    const message: TerminalMessage = { type: "output", data };
    ws.send(JSON.stringify(message));
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] PTY exited with code: ${exitCode}`);
    const message: TerminalMessage = { type: "exit", code: exitCode };
    ws.send(JSON.stringify(message));
    sessions.delete(ws);
    ws.close();
  });
}

export function handleTerminalMessage(
  ws: ServerWebSocket<TerminalWSData>,
  message: string
) {
  const session = sessions.get(ws);
  if (!session) {
    console.error("[terminal] No session found for WebSocket");
    return;
  }

  try {
    const msg: TerminalMessage = JSON.parse(message);

    if (msg.type === "input" && msg.data) {
      session.pty.write(msg.data);
    } else if (msg.type === "resize" && msg.cols && msg.rows) {
      console.log(`[terminal] Resize to ${msg.cols}x${msg.rows}`);
      session.pty.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    console.error("[terminal] Failed to parse message:", err);
  }
}

export function handleTerminalClose(ws: ServerWebSocket<TerminalWSData>) {
  const session = sessions.get(ws);
  if (session) {
    console.log("[terminal] Closing PTY");
    session.pty.kill();
    sessions.delete(ws);
  }
}
