import { readFile } from "fs/promises";
import path from "path";
import { getProvider } from "./agents";
import type { AgentType, ClientMessage, AgentMessage, AgentSettings, FileContext, Attachment } from "./types";
import {
  loadHistory,
  saveHistory,
  createHistory,
  addUserMessage,
  addAssistantMessage,
  updateToolResult,
  type ChatHistory,
} from "./storage";

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

// Current session settings (can be updated via "settings" messages)
let currentSettings: AgentSettings = {
  permissionMode: "bypassPermissions", // Default to auto-approve for now
  extendedThinking: true,
};

// Load or create chat history
let history: ChatHistory;
const existingHistory = await loadHistory(agent);

if (existingHistory) {
  history = existingHistory;
} else {
  history = createHistory(agent, crypto.randomUUID());
}

// Send init message with session info
send({ type: "init", sessionId: history.sessionId });

// Send history if we have messages
if (history.messages.length > 0) {
  send({ type: "history", history: history.messages });
}

// Helper: extract specific lines from content
function extractLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

// Helper: process file context from client message
async function processFileContext(
  context: ClientMessage["context"],
  cwd: string
): Promise<{ fileContext: FileContext[]; attachments: Attachment[] }> {
  const fileContext: FileContext[] = [];
  const attachments: Attachment[] = [];

  // Process file references
  if (context?.files) {
    for (const file of context.files) {
      const fc: FileContext = { path: file.path, selection: file.selection };

      if (file.include) {
        const fullPath = path.join(cwd, file.path);
        const content = await readFile(fullPath, "utf-8");
        fc.content = file.selection
          ? extractLines(content, file.selection.startLine, file.selection.endLine)
          : content;
      }

      fileContext.push(fc);
    }
  }

  // Pass through attachments
  if (context?.attachments) {
    for (const att of context.attachments) {
      attachments.push({
        filename: att.filename,
        mediaType: att.mediaType,
        data: att.data,
      });
    }
  }

  return { fileContext, attachments };
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
    case "settings":
      // Update session settings
      if (msg.settings) {
        currentSettings = { ...currentSettings, ...msg.settings };
      }
      break;

    case "prompt":
      if (!msg.prompt) {
        send({ type: "error", error: "Missing prompt" });
        return;
      }

      // Allow inline settings with prompt
      if (msg.settings) {
        currentSettings = { ...currentSettings, ...msg.settings };
      }

      // Build conversation history from saved messages BEFORE adding the new message
      // (to avoid duplicating the current prompt in history)
      const conversationHistory = history.messages
        .filter((m) => m.content && m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Save user message to history
      addUserMessage(history, msg.prompt);
      await saveHistory(history);

      // Process file context and attachments
      const cwd = process.env.PROJECT_CWD || process.cwd();
      const { fileContext, attachments } = await processFileContext(msg.context, cwd);

      try {
        let currentAssistantContent = "";

        for await (const agentMsg of provider.query(msg.prompt, {
          cwd,
          autoApprove: currentSettings.permissionMode === "bypassPermissions",
          model: currentSettings.model,
          permissionMode: currentSettings.permissionMode,
          extendedThinking: currentSettings.extendedThinking,
          conversationHistory,
          fileContext: fileContext.length > 0 ? fileContext : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        })) {
          send(agentMsg);

          // Track content for history
          if (agentMsg.type === "text" && agentMsg.content) {
            currentAssistantContent += agentMsg.content;
          }

          // Track tool use
          if (agentMsg.type === "tool_use" && agentMsg.tool) {
            // Save previous content if any
            if (currentAssistantContent) {
              addAssistantMessage(history, currentAssistantContent);
              currentAssistantContent = "";
            }
            // Save tool message
            addAssistantMessage(history, "", {
              id: agentMsg.tool.id,
              name: agentMsg.tool.name,
              input: agentMsg.tool.input,
              status: agentMsg.tool.status,
            });
          }

          // Track tool results
          if (agentMsg.type === "tool_result" && agentMsg.toolId) {
            updateToolResult(history, agentMsg.toolId, agentMsg.result, agentMsg.error);
          }

          // On done, save final content
          if (agentMsg.type === "done") {
            if (currentAssistantContent) {
              addAssistantMessage(history, currentAssistantContent);
            }
            await saveHistory(history);
          }
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
