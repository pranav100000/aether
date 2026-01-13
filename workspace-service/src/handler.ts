import { readFile } from "node:fs/promises"
import path from "node:path"
import { createProvider, isAgentConfigured } from "./agents"
import { buildFullPrompt } from "./utils/context"
import type { AgentType, ClientMessage, ServerMessage, AgentSettings, AgentProvider, ChatHistory } from "./types"
import {
  loadHistory,
  saveHistory,
  createHistory,
  addUserMessage,
  addAssistantMessage,
  updateToolResult,
} from "./storage"

export interface MessageSender {
  send(msg: ServerMessage): void
}

export interface AgentHandlerOptions {
  cwd?: string
}

/** Extract specific lines from file content */
function extractLines(content: string, startLine: number, endLine: number): string {
  return content.split("\n").slice(startLine - 1, endLine).join("\n")
}

/** Read file context from disk and build into prompt format */
async function buildFileContext(
  context: ClientMessage["context"],
  cwd: string
): Promise<Array<{ path: string; content?: string; selection?: { startLine: number; endLine: number } }>> {
  if (!context?.files) return []

  const files = []
  for (const file of context.files) {
    if (file.include) {
      const fullPath = path.join(cwd, file.path)
      const content = await readFile(fullPath, "utf-8")
      files.push({
        path: file.path,
        content: file.selection
          ? extractLines(content, file.selection.startLine, file.selection.endLine)
          : content,
        selection: file.selection,
      })
    } else {
      files.push({ path: file.path })
    }
  }
  return files
}

export class AgentHandler {
  private provider: AgentProvider
  private settings: AgentSettings
  private history!: ChatHistory
  private cwd: string

  constructor(
    public readonly agent: AgentType,
    private sender: MessageSender,
    options: AgentHandlerOptions = {}
  ) {
    this.cwd = options.cwd || process.env.PROJECT_CWD || process.cwd()

    if (!isAgentConfigured(agent)) {
      throw new Error(`Agent ${agent} is not configured (missing API key)`)
    }

    this.provider = createProvider(agent, { cwd: this.cwd })
    this.settings = {
      permissionMode: "bypassPermissions",
      extendedThinking: true,
    }
  }

  async initialize(): Promise<void> {
    const existingHistory = await loadHistory(this.agent)
    this.history = existingHistory ?? createHistory(this.agent, crypto.randomUUID())

    this.sender.send({ type: "init", sessionId: this.history.sessionId })

    if (this.history.messages.length > 0) {
      this.sender.send({
        type: "history",
        history: this.history.messages,
      })
    }
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "settings":
        if (msg.settings) {
          this.settings = { ...this.settings, ...msg.settings }
        }
        break

      case "prompt":
        // Don't await - process in background so abort can interrupt
        this.handlePrompt(msg).catch((err) => {
          this.sender.send({ type: "error", error: String(err) })
        })
        break

      case "abort":
        this.provider.abort()
        this.sender.send({ type: "done" })
        break

      case "approve":
      case "reject":
        // Tool approval not implemented yet
        break
    }
  }

  private async handlePrompt(msg: ClientMessage): Promise<void> {
    if (!msg.prompt) {
      this.sender.send({ type: "error", error: "Missing prompt" })
      return
    }

    // Allow inline settings
    if (msg.settings) {
      this.settings = { ...this.settings, ...msg.settings }
    }

    // Build conversation history for context
    const conversationHistory = this.history.messages
      .filter((m) => m.content && m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Save user message
    addUserMessage(this.history, msg.prompt)
    await saveHistory(this.history)

    // Process file context and build full prompt
    const fileContext = await buildFileContext(msg.context, this.cwd)
    const fullPrompt = buildFullPrompt(msg.prompt, fileContext, conversationHistory, "xml")

    try {
      let currentAssistantContent = ""

      for await (const event of this.provider.query(fullPrompt, {
        model: this.settings.model,
        autoApprove: this.settings.permissionMode === "bypassPermissions",
        thinkingTokens: this.settings.extendedThinking ? 10000 : undefined,
      })) {
        this.sender.send(event)

        // Track content for history
        if (event.type === "text" && event.content) {
          currentAssistantContent += event.content
        }

        if (event.type === "tool_use" && event.tool) {
          if (currentAssistantContent) {
            addAssistantMessage(this.history, currentAssistantContent)
            currentAssistantContent = ""
          }
          addAssistantMessage(this.history, "", {
            id: event.tool.id,
            name: event.tool.name,
            input: event.tool.input,
            status: event.tool.status,
          })
        }

        if (event.type === "tool_result" && event.toolId) {
          updateToolResult(this.history, event.toolId, event.result, event.error)
        }

        if (event.type === "done") {
          if (currentAssistantContent) {
            addAssistantMessage(this.history, currentAssistantContent)
          }
          await saveHistory(this.history)
        }
      }
    } catch (err) {
      this.sender.send({ type: "error", error: String(err) })
    }
  }
}
