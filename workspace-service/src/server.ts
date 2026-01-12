import { AgentHandler } from "./handler"
import type { AgentType, ClientMessage, ServerMessage } from "./types"
import type { ServerWebSocket } from "bun"

const PORT = parseInt(process.env.AGENT_PORT || "3001");
const VALID_AGENTS = ["claude", "codex", "codebuff", "opencode"];

interface WSData {
  agent: AgentType;
  handler?: AgentHandler;
}

const server = Bun.serve<WSData>({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/agent\/(\w+)$/);

    if (match && VALID_AGENTS.includes(match[1])) {
      const upgraded = server.upgrade(req, {
        data: { agent: match[1] as AgentType },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    async open(ws: ServerWebSocket<WSData>) {
      const { agent } = ws.data;
      console.log(`[${agent}] WebSocket connected`);

      try {
        const handler = new AgentHandler(agent, {
          send: (msg: ServerMessage) => {
            ws.send(JSON.stringify({ ...msg, agent }))
          },
        })

        ws.data.handler = handler;
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
      const { agent, handler } = ws.data;

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
      const { agent } = ws.data;
      console.log(`[${agent}] WebSocket closed`);
    },
  },
});

console.log(`Agent service running at ws://localhost:${PORT}`);
console.log(`Available endpoints:`);
for (const agent of VALID_AGENTS) {
  console.log(`  ws://localhost:${PORT}/agent/${agent}`);
}
console.log(`Health check: http://localhost:${PORT}/health`);
