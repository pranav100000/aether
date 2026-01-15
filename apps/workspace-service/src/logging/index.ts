import pino from "pino";
import * as Sentry from "@sentry/bun";

// Initialize Sentry
const SENTRY_DSN =
  "https://cd2942e3079c4f215326dfcb9eea424c@o4510703250505728.ingest.us.sentry.io/4510707850936320";
Sentry.init({
  dsn: SENTRY_DSN,
  environment: Bun.env.ENVIRONMENT || "development",
  tracesSampleRate: 0.1,
  integrations: [
    // Send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],
  // Enable logs to be sent to Sentry
  enableLogs: true,
});

/**
 * Logger wraps pino to provide a stable API that doesn't leak implementation details.
 * This allows us to:
 * 1. Swap logging backends without changing consumer code
 * 2. Add hooks (e.g., Sentry) in one place
 * 3. Control the API surface
 */
export class Logger {
  private pino: pino.Logger;

  constructor(pinoInstance: pino.Logger) {
    this.pino = pinoInstance;
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, unknown>): Logger {
    return new Logger(this.pino.child(bindings));
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.debug(data, msg);
    } else {
      this.pino.debug(msg);
    }
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.info(data, msg);
    } else {
      this.pino.info(msg);
    }
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.warn(data, msg);
    } else {
      this.pino.warn(msg);
    }
  }

  /**
   * Log at error level and capture to Sentry if enabled
   */
  error(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.error(data, msg);
    } else {
      this.pino.error(msg);
    }

    // Capture to Sentry
    if (SENTRY_DSN) {
      Sentry.withScope((scope) => {
        if (data) {
          scope.setExtras(data);
        }
        Sentry.captureMessage(msg, "error");
      });
    }
  }
}

// Configuration from environment
const LOG_LEVEL = Bun.env.LOG_LEVEL || "info";
const LOG_FORMAT = Bun.env.LOG_FORMAT || (Bun.env.NODE_ENV === "development" ? "text" : "json");

// Create base pino instance
const pinoOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
};

let pinoInstance: pino.Logger;

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
  });
} else {
  // JSON for production
  pinoInstance = pino(pinoOptions);
}

/** Root logger instance */
export const logger = new Logger(pinoInstance);

/** Correlation context passed from the backend via WebSocket connection */
export interface CorrelationContext {
  requestId?: string;
  userId?: string;
  projectId?: string;
}

/**
 * Create a logger with correlation context
 * Context should be passed explicitly per-connection to avoid race conditions
 */
export function createContextLogger(
  ctx: CorrelationContext,
  additional?: Record<string, unknown>
): Logger {
  const bindings: Record<string, unknown> = {};

  if (ctx.requestId) bindings.request_id = ctx.requestId;
  if (ctx.userId) bindings.user_id = ctx.userId;
  if (ctx.projectId) bindings.project_id = ctx.projectId;

  if (additional) {
    Object.assign(bindings, additional);
  }

  return Object.keys(bindings).length > 0 ? logger.child(bindings) : logger;
}
