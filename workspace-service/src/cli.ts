import { AgentHandler } from "./handler"
import type { AgentType, ClientMessage, ServerMessage } from "./types"

const agent = process.argv[2] as AgentType;

if (!agent) {
  console.error("Usage: bun cli.ts <agent>");
  process.exit(1);
}

function send(msg: ServerMessage) {
  console.log(JSON.stringify({ ...msg, agent }))
}

let handler: AgentHandler;

try {
  handler = new AgentHandler(agent, { send });
} catch (err) {
  send({ type: "error", error: String(err) });
  process.exit(1);
}

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  send({ type: "error", error: `Uncaught: ${err.message}` });
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  send({ type: "error", error: `Unhandled: ${String(err)}` });
  process.exit(1);
});

// Initialize handler (loads history, sends init message)
await handler.initialize();

// Read JSON lines from stdin
const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);

  // Process complete lines
  const lines = buffer.split("\n");
  buffer = lines.pop() || ""; // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg: ClientMessage = JSON.parse(line);
      await handler.handleMessage(msg);
    } catch (err) {
      send({ type: "error", error: String(err) });
    }
  }
}
