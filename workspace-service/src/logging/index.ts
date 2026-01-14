import pino from "pino"

/**
 * Logger wraps pino to provide a stable API that doesn't leak implementation details.
 * This allows us to:
 * 1. Swap logging backends without changing consumer code
 * 2. Add hooks (e.g., Sentry) in one place
 * 3. Control the API surface
 */
export class Logger {
  private pino: pino.Logger

  constructor(pinoInstance: pino.Logger) {
    this.pino = pinoInstance
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, unknown>): Logger {
    return new Logger(this.pino.child(bindings))
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.debug(data, msg)
    } else {
      this.pino.debug(msg)
    }
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.info(data, msg)
    } else {
      this.pino.info(msg)
    }
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.warn(data, msg)
    } else {
      this.pino.warn(msg)
    }
  }

  /**
   * Log at error level - hook point for Sentry integration
   */
  error(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.error(data, msg)
    } else {
      this.pino.error(msg)
    }
    // TODO: Add Sentry capture here when integrated
  }
}

// Configuration from environment
const LOG_LEVEL = process.env.LOG_LEVEL || "info"
const LOG_FORMAT = process.env.LOG_FORMAT || (process.env.NODE_ENV === "development" ? "text" : "json")

// Create base pino instance
const pinoOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
}

let pinoInstance: pino.Logger

if (LOG_FORMAT === "text") {
  // Pretty print for development
  pinoInstance = pino({
    ...pinoOptions,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  })
} else {
  // JSON for production
  pinoInstance = pino(pinoOptions)
}

/** Root logger instance */
export const logger = new Logger(pinoInstance)

/** Correlation context from environment (set by backend via headers) */
export interface CorrelationContext {
  requestId?: string
  userId?: string
  projectId?: string
}

/**
 * Get correlation context from environment variables
 * These are set by the backend when establishing the WebSocket connection
 */
export function getCorrelationContext(): CorrelationContext {
  return {
    requestId: process.env.CORRELATION_REQUEST_ID,
    userId: process.env.CORRELATION_USER_ID,
    projectId: process.env.CORRELATION_PROJECT_ID,
  }
}

/**
 * Create a logger with correlation context from environment
 */
export function createContextLogger(additional?: Record<string, unknown>): Logger {
  const ctx = getCorrelationContext()
  const bindings: Record<string, unknown> = {}

  if (ctx.requestId) bindings.request_id = ctx.requestId
  if (ctx.userId) bindings.user_id = ctx.userId
  if (ctx.projectId) bindings.project_id = ctx.projectId

  if (additional) {
    Object.assign(bindings, additional)
  }

  return Object.keys(bindings).length > 0 ? logger.child(bindings) : logger
}
