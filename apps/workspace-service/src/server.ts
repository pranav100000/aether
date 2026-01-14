import { AgentHandler } from "./handler"
import { PTYHandler, FileWatcher, PortWatcher, isTerminalMessage } from "./channels"
import { logger, createContextLogger, Logger, CorrelationContext } from "./logging"
import type { AgentType, ClientMessage, ServerMessage } from "./types"
import type { TerminalInputMessage, TerminalResizeMessage } from "./channels"
import type { ServerWebSocket } from "bun"

const PORT = parseInt(process.env.AGENT_PORT || "3001")
const VALID_AGENTS = ["claude", "codex", "codebuff", "opencode"]
const PROJECT_CWD = process.env.PROJECT_CWD || "/home/coder/project"

interface WSData {
  mode: "workspace" | "agent-only"
  agent?: AgentType
  environment: Record<string, string>
  log?: Logger
  agentHandler?: AgentHandler
  ptyHandler?: PTYHandler
  fileWatcher?: FileWatcher
  portWatcher?: PortWatcher
}

/**
 * Extract environment variables from request headers.
 * Headers are named X-Agent-Env-{KEY} with base64-encoded values.
 */
function extractEnvironment(req: Request): Record<string, string> {
  const env: Record<string, string> = {}
  const prefix = "x-agent-env-"

  req.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (lowerKey.startsWith(prefix)) {
      const envKey = key.substring(prefix.length)
      try {
        env[envKey] = atob(value)
      } catch {
        logger.error("failed to decode env var", { key: envKey })
      }
    }
  })

  return env
}

/**
 * Apply environment variables to the process.
 */
function applyEnvironment(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
}

const server = Bun.serve<WSData>({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url)
    const environment = extractEnvironment(req)

    // New unified workspace endpoint
    if (url.pathname === "/workspace") {
      const upgraded = server.upgrade(req, {
        data: {
          mode: "workspace",
          environment,
        },
      })
      if (upgraded) return undefined
      return new Response("WebSocket upgrade failed", { status: 500 })
    }

    // Legacy agent-only endpoint (backwards compatibility)
    const agentMatch = url.pathname.match(/^\/agent\/(\w+)$/)
    if (agentMatch && VALID_AGENTS.includes(agentMatch[1])) {
      const upgraded = server.upgrade(req, {
        data: {
          mode: "agent-only",
          agent: agentMatch[1] as AgentType,
          environment,
        },
      })
      if (upgraded) return undefined
      return new Response("WebSocket upgrade failed", { status: 500 })
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 })
    }

    return new Response("Not Found", { status: 404 })
  },

  websocket: {
    async open(ws: ServerWebSocket<WSData>) {
      const { mode, environment } = ws.data

      // Apply environment variables (for non-correlation config like API keys)
      if (Object.keys(environment).length > 0) {
        applyEnvironment(environment)
      }

      // Extract correlation context directly from environment (not process.env)
      // to avoid race conditions with concurrent connections
      const correlationCtx: CorrelationContext = {
        requestId: environment.CORRELATION_REQUEST_ID,
        userId: environment.CORRELATION_USER_ID,
        projectId: environment.CORRELATION_PROJECT_ID,
      }

      // Create connection-scoped logger with correlation context
      const log = createContextLogger(correlationCtx, { channel: "websocket", mode })
      ws.data.log = log

      log.info("connection opened", { env_count: Object.keys(environment).length })

      try {
        if (mode === "workspace") {
          // Unified mode: initialize PTY
          const ptyHandler = new PTYHandler({ cwd: PROJECT_CWD })
          ptyHandler.initialize((msg) => {
            ws.send(JSON.stringify(msg))
          })
          ws.data.ptyHandler = ptyHandler
          log.info("PTY initialized")

          // Initialize file watcher
          const fileWatcher = new FileWatcher({ projectDir: PROJECT_CWD })
          await fileWatcher.initialize((msg) => {
            ws.send(JSON.stringify(msg))
          })
          ws.data.fileWatcher = fileWatcher
          log.info("FileWatcher initialized")

          // Initialize port watcher
          const portWatcher = new PortWatcher()
          portWatcher.initialize((msg) => {
            ws.send(JSON.stringify(msg))
          })
          ws.data.portWatcher = portWatcher
          log.info("PortWatcher initialized")

          // Agent handler will be created on first agent message
          // (since we need to know which agent type)
        } else {
          // Legacy agent-only mode
          const agent = ws.data.agent!
          const agentHandler = new AgentHandler(agent, {
            send: (msg: ServerMessage) => {
              ws.send(JSON.stringify({ ...msg, agent }))
            },
          })
          ws.data.agentHandler = agentHandler
          await agentHandler.initialize()
          log.info("agent handler initialized", { agent })
        }
      } catch (err) {
        log.error("failed to initialize", { error: String(err) })
        ws.send(JSON.stringify({
          type: "error",
          error: String(err),
        }))
        ws.close()
      }
    },

    async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
      const log = ws.data.log ?? logger
      try {
        const msg = JSON.parse(String(message))

        // Route by channel (unified mode) or handle directly (legacy mode)
        if (ws.data.mode === "workspace") {
          await handleWorkspaceMessage(ws, msg)
        } else {
          // Legacy agent-only mode
          if (ws.data.agentHandler) {
            await ws.data.agentHandler.handleMessage(msg as ClientMessage)
          }
        }
      } catch (err) {
        log.error("error handling message", { error: String(err) })
        ws.send(JSON.stringify({
          type: "error",
          error: String(err),
        }))
      }
    },

    close(ws: ServerWebSocket<WSData>) {
      const log = ws.data.log ?? logger
      log.info("connection closed")

      // Cleanup handlers
      ws.data.ptyHandler?.close()
      ws.data.fileWatcher?.close()
      ws.data.portWatcher?.close()
    },
  },
})

/**
 * Handle messages in unified workspace mode with channel routing
 */
async function handleWorkspaceMessage(ws: ServerWebSocket<WSData>, msg: unknown): Promise<void> {
  const log = ws.data.log ?? logger
  const channelMsg = msg as { channel?: string; type?: string; agent?: string }

  // Route by channel
  switch (channelMsg.channel) {
    case "terminal":
      if (ws.data.ptyHandler && isTerminalMessage(msg)) {
        ws.data.ptyHandler.handleMessage(msg as TerminalInputMessage | TerminalResizeMessage)
      }
      break

    case "agent":
      await handleAgentMessage(ws, msg)
      break

    case "files":
      // File operations handled separately (watchers send outbound only)
      log.debug("files channel message", { type: channelMsg.type })
      break

    case "ports":
      // Port operations handled separately (watchers send outbound only)
      log.debug("ports channel message", { type: channelMsg.type })
      break

    default:
      // No channel field - might be legacy agent message format
      // Try to handle as agent message
      if (channelMsg.type === "prompt" || channelMsg.type === "abort" || channelMsg.type === "settings") {
        await handleAgentMessage(ws, { ...(msg as Record<string, unknown>), channel: "agent" })
      } else {
        log.warn("unknown message format", { type: channelMsg.type, channel: channelMsg.channel })
      }
  }
}

/**
 * Handle agent channel messages
 */
async function handleAgentMessage(ws: ServerWebSocket<WSData>, msg: unknown): Promise<void> {
  const log = ws.data.log ?? logger
  const agentMsg = msg as { agent?: string; type?: string }
  const agentType = (agentMsg.agent || "claude") as AgentType

  // Create agent handler on first message if needed
  if (!ws.data.agentHandler || ws.data.agent !== agentType) {
    log.info("creating agent handler", { agent: agentType })
    ws.data.agent = agentType
    ws.data.agentHandler = new AgentHandler(agentType, {
      send: (serverMsg: ServerMessage) => {
        // Wrap in channel format
        ws.send(JSON.stringify({
          channel: "agent",
          ...serverMsg,
          agent: agentType,
        }))
      },
    })
    await ws.data.agentHandler.initialize()
  }

  // Forward to agent handler
  await ws.data.agentHandler.handleMessage(agentMsg as ClientMessage)
}

logger.info("workspace service started", {
  port: PORT,
  endpoints: {
    workspace: `ws://localhost:${PORT}/workspace`,
    agents: VALID_AGENTS.map(a => `ws://localhost:${PORT}/agent/${a}`),
    health: `http://localhost:${PORT}/health`,
  },
})
