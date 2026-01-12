import { readFile } from "fs/promises";
import path from "path";
import { getProvider } from "./agents";
import type { AgentType, ClientMessage, AgentMessage, AgentSettings, FileContext, Attachment, AgentProvider } from "./types";
import {
  loadHistory,
  saveHistory,
  createHistory,
  addUserMessage,
  addAssistantMessage,
  updateToolResult,
  type ChatHistory,
} from "./storage";

export interface MessageSender {
  send(msg: AgentMessage): void;
}

export interface AgentHandlerOptions {
  cwd?: string;
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

export class AgentHandler {
  private provider: AgentProvider;
  private settings: AgentSettings;
  private history!: ChatHistory;
  private cwd: string;

  constructor(
    public readonly agent: AgentType,
    private sender: MessageSender,
    options: AgentHandlerOptions = {}
  ) {
    this.provider = getProvider(agent);
    this.settings = {
      permissionMode: "bypassPermissions",
      extendedThinking: true,
    };
    this.cwd = options.cwd || process.env.PROJECT_CWD || process.cwd();
  }

  async initialize(): Promise<void> {
    const existingHistory = await loadHistory(this.agent);
    this.history = existingHistory ?? createHistory(this.agent, crypto.randomUUID());

    this.sender.send({ type: "init", sessionId: this.history.sessionId });

    if (this.history.messages.length > 0) {
      this.sender.send({ type: "history", history: this.history.messages });
    }
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "settings":
        if (msg.settings) {
          this.settings = { ...this.settings, ...msg.settings };
        }
        break;

      case "prompt":
        await this.handlePrompt(msg);
        break;

      case "abort":
        this.provider.abort();
        this.sender.send({ type: "done" });
        break;

      case "approve":
        if (this.provider.approveToolUse && msg.toolId) {
          this.provider.approveToolUse(msg.toolId);
        }
        break;

      case "reject":
        if (this.provider.rejectToolUse && msg.toolId) {
          this.provider.rejectToolUse(msg.toolId);
        }
        break;
    }
  }

  private async handlePrompt(msg: ClientMessage): Promise<void> {
    if (!msg.prompt) {
      this.sender.send({ type: "error", error: "Missing prompt" });
      return;
    }

    // Allow inline settings with prompt
    if (msg.settings) {
      this.settings = { ...this.settings, ...msg.settings };
    }

    // Build conversation history from saved messages BEFORE adding the new message
    const conversationHistory = this.history.messages
      .filter((m) => m.content && m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Save user message to history
    addUserMessage(this.history, msg.prompt);
    await saveHistory(this.history);

    // Process file context and attachments
    const { fileContext, attachments } = await processFileContext(msg.context, this.cwd);

    try {
      let currentAssistantContent = "";

      for await (const agentMsg of this.provider.query(msg.prompt, {
        cwd: this.cwd,
        autoApprove: this.settings.permissionMode === "bypassPermissions",
        model: this.settings.model,
        permissionMode: this.settings.permissionMode,
        extendedThinking: this.settings.extendedThinking,
        conversationHistory,
        fileContext: fileContext.length > 0 ? fileContext : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      })) {
        this.sender.send(agentMsg);

        // Track content for history
        if (agentMsg.type === "text" && agentMsg.content) {
          currentAssistantContent += agentMsg.content;
        }

        // Track tool use
        if (agentMsg.type === "tool_use" && agentMsg.tool) {
          // Save previous content if any
          if (currentAssistantContent) {
            addAssistantMessage(this.history, currentAssistantContent);
            currentAssistantContent = "";
          }
          // Save tool message
          addAssistantMessage(this.history, "", {
            id: agentMsg.tool.id,
            name: agentMsg.tool.name,
            input: agentMsg.tool.input,
            status: agentMsg.tool.status,
          });
        }

        // Track tool results
        if (agentMsg.type === "tool_result" && agentMsg.toolId) {
          updateToolResult(this.history, agentMsg.toolId, agentMsg.result, agentMsg.error);
        }

        // On done, save final content
        if (agentMsg.type === "done") {
          if (currentAssistantContent) {
            addAssistantMessage(this.history, currentAssistantContent);
          }
          await saveHistory(this.history);
        }
      }
    } catch (err) {
      this.sender.send({ type: "error", error: String(err) });
    }
  }
}
