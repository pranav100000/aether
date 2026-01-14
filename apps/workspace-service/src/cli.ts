// import { AgentHandler } from "./handler"
// import { StdioConnector } from "./connector"
// import type { AgentType, ClientMessage, ServerMessage } from "./types"

// const agent = Bun.argv[2] as AgentType;

// if (!agent) {
//   console.error("Usage: bun cli.ts <agent>");
//   process.exit(1);
// }

// // Create connector and handler
// const connector = new StdioConnector();

// let handler: AgentHandler;

// try {
//   handler = new AgentHandler(agent, {
//     send: (msg: ServerMessage) => connector.send(msg)
//   });
// } catch (err) {
//   connector.send({ type: "error", error: String(err) });
//   process.exit(1);
// }

// // Handle uncaught errors
// process.on("uncaughtException", (err) => {
//   connector.send({ type: "error", error: `Uncaught: ${err.message}` });
//   process.exit(1);
// });

// process.on("unhandledRejection", (err) => {
//   connector.send({ type: "error", error: `Unhandled: ${String(err)}` });
//   process.exit(1);
// });

// // Set up message handling
// connector.onMessage(async (data) => {
//   await handler.handleMessage(data as ClientMessage);
// });

// connector.onClose(() => {
//   process.exit(0);
// });

// // Initialize connector and handler
// await connector.initialize({ agentType: agent });
// await handler.initialize();
