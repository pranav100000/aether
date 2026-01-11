import { AgentHandler } from "./handler";
import type { AgentType, ClientMessage, AgentMessage } from "./types";
import type { ServerWebSocket } from "bun";
import { authenticateRequest, extractTokenFromProtocol, validateToken } from "./auth";
import {
  listTree,
  listOrRead,
  writeFile,
  createDirectory,
  deleteFile,
  renameFile,
} from "./files";
import {
  handleTerminalOpen,
  handleTerminalMessage,
  handleTerminalClose,
  type TerminalWSData,
} from "./terminal";
import {
  handleEventsOpen,
  handleEventsClose,
  type EventsWSData,
} from "./watcher";

const PORT = parseInt(process.env.AGENT_PORT || process.env.PORT || "3001");
const VALID_AGENTS = ["claude", "codex", "codebuff", "opencode"];

// Debug: log API key env vars (names only, not values)
const apiKeyVars = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "CODEBUFF_API_KEY", "CODEBUFF_BYOK_OPENROUTER", "CODEX_API_KEY"];
console.log("[env] API key env vars present:", apiKeyVars.filter(k => !!process.env[k]));

// CORS headers for cross-origin requests
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, fly-force-instance-id",
};

// Agent WebSocket data
interface AgentWSData {
  type: "agent";
  agent: AgentType;
  userId: string;
  handler?: AgentHandler;
}

// Union type for all WebSocket connections
type WSData = AgentWSData | TerminalWSData | EventsWSData;

// Helper to create JSON response with CORS headers
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Helper to create error response
function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// Handle file routes (requires authentication)
async function handleFileRoutes(req: Request): Promise<Response> {
  // Authenticate request
  const userId = await authenticateRequest(req);
  if (!userId) {
    return errorResponse("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // GET /files/tree - list all files recursively
    if (pathname === "/files/tree" && method === "GET") {
      const tree = await listTree();
      return jsonResponse(tree);
    }

    // GET /files?path=/foo - list directory or read file
    if (pathname === "/files" && method === "GET") {
      const path = url.searchParams.get("path") || "/";
      const result = await listOrRead(path);
      return jsonResponse(result);
    }

    // PUT /files?path=/foo - write file
    if (pathname === "/files" && method === "PUT") {
      const path = url.searchParams.get("path");
      if (!path) {
        return errorResponse("Missing 'path' parameter", 400);
      }

      const body = await req.json() as { content: string };
      if (typeof body.content !== "string") {
        return errorResponse("Missing 'content' in request body", 400);
      }

      const result = await writeFile(path, body.content);
      return jsonResponse(result);
    }

    // DELETE /files?path=/foo - delete file or directory
    if (pathname === "/files" && method === "DELETE") {
      const path = url.searchParams.get("path");
      if (!path) {
        return errorResponse("Missing 'path' parameter", 400);
      }

      await deleteFile(path);
      return new Response(null, { status: 204 });
    }

    // POST /files/mkdir - create directory
    if (pathname === "/files/mkdir" && method === "POST") {
      const body = await req.json() as { path: string };
      if (!body.path) {
        return errorResponse("Missing 'path' in request body", 400);
      }

      await createDirectory(body.path);
      return jsonResponse({ path: body.path });
    }

    // POST /files/rename - rename file or directory
    if (pathname === "/files/rename" && method === "POST") {
      const body = await req.json() as { old_path: string; new_path: string };
      if (!body.old_path || !body.new_path) {
        return errorResponse("Missing 'old_path' or 'new_path' in request body", 400);
      }

      await renameFile(body.old_path, body.new_path);
      return jsonResponse({ path: body.new_path });
    }

    return errorResponse("Not Found", 404);
  } catch (err) {
    console.error("File operation error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message, 400);
  }
}

const server = Bun.serve<WSData>({
  port: PORT,
  hostname: "0.0.0.0", // Bind to all interfaces for Fly.io

  async fetch(req, server) {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // Agent WebSocket routes
    const agentMatch = pathname.match(/^\/agent\/(\w+)$/);
    if (agentMatch && VALID_AGENTS.includes(agentMatch[1])) {
      // Extract token from Sec-WebSocket-Protocol header (browser sends "bearer, <token>")
      const protocols = req.headers.get("sec-websocket-protocol");
      const token = extractTokenFromProtocol(protocols);

      if (!token) {
        return new Response("Unauthorized: Missing token", { status: 401, headers: CORS_HEADERS });
      }

      try {
        const userId = await validateToken(token);
        console.log(`[agent] Authenticated user: ${userId}`);

        const upgraded = server.upgrade(req, {
          data: { type: "agent" as const, agent: agentMatch[1] as AgentType, userId },
          // Echo back the subprotocol so browser accepts the connection
          headers: { "Sec-WebSocket-Protocol": protocols! },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500, headers: CORS_HEADERS });
      } catch (err) {
        console.error("[agent] Auth error:", err);
        return new Response("Unauthorized: Invalid token", { status: 401, headers: CORS_HEADERS });
      }
    }

    // Terminal WebSocket route
    if (pathname === "/terminal") {
      const protocols = req.headers.get("sec-websocket-protocol");
      const token = extractTokenFromProtocol(protocols);

      if (!token) {
        return new Response("Unauthorized: Missing token", { status: 401, headers: CORS_HEADERS });
      }

      try {
        const userId = await validateToken(token);
        console.log(`[terminal] Authenticated user: ${userId}`);

        const upgraded = server.upgrade(req, {
          data: { type: "terminal" as const, userId },
          headers: { "Sec-WebSocket-Protocol": protocols! },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500, headers: CORS_HEADERS });
      } catch (err) {
        console.error("[terminal] Auth error:", err);
        return new Response("Unauthorized: Invalid token", { status: 401, headers: CORS_HEADERS });
      }
    }

    // Events WebSocket route (file change notifications)
    if (pathname === "/events") {
      const protocols = req.headers.get("sec-websocket-protocol");
      const token = extractTokenFromProtocol(protocols);

      if (!token) {
        return new Response("Unauthorized: Missing token", { status: 401, headers: CORS_HEADERS });
      }

      try {
        const userId = await validateToken(token);
        console.log(`[events] Authenticated user: ${userId}`);

        const upgraded = server.upgrade(req, {
          data: { type: "events" as const, userId },
          headers: { "Sec-WebSocket-Protocol": protocols! },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500, headers: CORS_HEADERS });
      } catch (err) {
        console.error("[events] Auth error:", err);
        return new Response("Unauthorized: Invalid token", { status: 401, headers: CORS_HEADERS });
      }
    }

    // File operation routes
    if (pathname.startsWith("/files")) {
      return handleFileRoutes(req);
    }

    // Health check endpoint
    if (pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    async open(ws: ServerWebSocket<WSData>) {
      const { type } = ws.data;

      if (type === "terminal") {
        console.log("[terminal] WebSocket connected");
        handleTerminalOpen(ws as ServerWebSocket<TerminalWSData>);
        return;
      }

      if (type === "events") {
        console.log("[events] WebSocket connected");
        handleEventsOpen(ws as ServerWebSocket<EventsWSData>);
        return;
      }

      // Agent connection
      const agentData = ws.data as AgentWSData;
      const { agent } = agentData;
      console.log(`[${agent}] WebSocket connected`);

      try {
        const handler = new AgentHandler(agent, {
          send: (msg: AgentMessage) => {
            ws.send(JSON.stringify({ ...msg, agent }));
          },
        });

        agentData.handler = handler;
        await handler.initialize();
      } catch (err) {
        console.error(`[${agent}] Failed to initialize handler:`, err);
        ws.send(JSON.stringify({
          type: "error",
          error: String(err),
          agent,
        }));
        ws.close();
      }
    },

    async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
      const { type } = ws.data;

      if (type === "terminal") {
        handleTerminalMessage(ws as ServerWebSocket<TerminalWSData>, String(message));
        return;
      }

      if (type === "events") {
        // Events WebSocket is read-only (server pushes to client)
        return;
      }

      // Agent message
      const agentData = ws.data as AgentWSData;
      const { agent, handler } = agentData;

      if (!handler) {
        ws.send(JSON.stringify({
          type: "error",
          error: "Handler not initialized",
          agent,
        }));
        return;
      }

      try {
        const msg: ClientMessage = JSON.parse(String(message));
        console.log(`[${agent}] Received:`, msg.type);
        await handler.handleMessage(msg);
      } catch (err) {
        console.error(`[${agent}] Error handling message:`, err);
        ws.send(JSON.stringify({
          type: "error",
          error: String(err),
          agent,
        }));
      }
    },

    close(ws: ServerWebSocket<WSData>) {
      const { type } = ws.data;

      if (type === "terminal") {
        console.log("[terminal] WebSocket closed");
        handleTerminalClose(ws as ServerWebSocket<TerminalWSData>);
        return;
      }

      if (type === "events") {
        console.log("[events] WebSocket closed");
        handleEventsClose(ws as ServerWebSocket<EventsWSData>);
        return;
      }

      const agentData = ws.data as AgentWSData;
      console.log(`[${agentData.agent}] WebSocket closed`);
    },
  },
});

console.log(`Workspace service running on port ${PORT}`);
console.log(`Available endpoints:`);
console.log(`  File operations:`);
console.log(`    GET  /files/tree         - List all files`);
console.log(`    GET  /files?path=/foo    - List directory or read file`);
console.log(`    PUT  /files?path=/foo    - Write file`);
console.log(`    DELETE /files?path=/foo  - Delete file/directory`);
console.log(`    POST /files/mkdir        - Create directory`);
console.log(`    POST /files/rename       - Rename file/directory`);
console.log(`  WebSockets:`);
console.log(`    ws://localhost:${PORT}/terminal - Terminal PTY`);
console.log(`    ws://localhost:${PORT}/events   - File change events`);
for (const agent of VALID_AGENTS) {
  console.log(`    ws://localhost:${PORT}/agent/${agent}`);
}
console.log(`  Health: http://localhost:${PORT}/health`);
