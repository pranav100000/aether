import { getProvider } from "./agents";
import type { AgentType, ClientMessage, AgentMessage } from "./types";

const agent = process.argv[2] as AgentType;

if (!agent) {
  console.error("Usage: bun cli.ts <agent>");
  process.exit(1);
}

let provider: ReturnType<typeof getProvider>;

try {
  provider = getProvider(agent);
} catch (err) {
  send({ type: "error", error: String(err) });
  process.exit(1);
}

// Send init message
const sessionId = crypto.randomUUID();
send({ type: "init", sessionId });

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  send({ type: "error", error: `Uncaught: ${err.message}` });
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  send({ type: "error", error: `Unhandled: ${String(err)}` });
  process.exit(1);
});

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
      await handleMessage(msg);
    } catch (err) {
      send({ type: "error", error: String(err) });
    }
  }
}

async function handleMessage(msg: ClientMessage) {
  switch (msg.type) {
    case "prompt":
      if (!msg.prompt) {
        send({ type: "error", error: "Missing prompt" });
        return;
      }

      try {
        for await (const agentMsg of provider.query(msg.prompt, {
          cwd: "/home/coder/project",
          autoApprove: true, // For now, auto-approve all tools
        })) {
          send(agentMsg);
        }
      } catch (err) {
        send({ type: "error", error: String(err) });
      }
      break;

    case "abort":
      provider.abort();
      send({ type: "done" });
      break;

    case "approve":
      if (provider.approveToolUse && msg.toolId) {
        provider.approveToolUse(msg.toolId);
      }
      break;

    case "reject":
      if (provider.rejectToolUse && msg.toolId) {
        provider.rejectToolUse(msg.toolId);
      }
      break;
  }
}

function send(msg: AgentMessage) {
  console.log(JSON.stringify({ ...msg, agent }));
}
