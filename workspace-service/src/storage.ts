import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { AgentType, StoredMessage, ChatHistory } from "./types"

const STORAGE_DIR = process.env.STORAGE_DIR || "./data/.aether"

function getAgentDir(agent: AgentType): string {
  return join(STORAGE_DIR, agent)
}

function getSessionPath(agent: AgentType, sessionId: string): string {
  return join(getAgentDir(agent), `${sessionId}.json`)
}

function getCurrentSessionPath(agent: AgentType): string {
  return join(getAgentDir(agent), "current")
}

async function getCurrentSessionId(agent: AgentType): Promise<string | null> {
  try {
    const currentPath = getCurrentSessionPath(agent)
    const sessionId = await readFile(currentPath, "utf-8")
    return sessionId.trim()
  } catch {
    return null
  }
}

async function setCurrentSessionId(agent: AgentType, sessionId: string): Promise<void> {
  const agentDir = getAgentDir(agent)
  await mkdir(agentDir, { recursive: true })
  await writeFile(getCurrentSessionPath(agent), sessionId)
}

export async function loadHistory(agent: AgentType): Promise<ChatHistory | null> {
  const sessionId = await getCurrentSessionId(agent)
  if (!sessionId) return null
  return loadSession(agent, sessionId)
}

export async function loadSession(agent: AgentType, sessionId: string): Promise<ChatHistory | null> {
  try {
    const data = await readFile(getSessionPath(agent, sessionId), "utf-8")
    return JSON.parse(data) as ChatHistory
  } catch {
    return null
  }
}

export async function saveHistory(history: ChatHistory): Promise<void> {
  const agentDir = getAgentDir(history.agent)
  await mkdir(agentDir, { recursive: true })

  history.updatedAt = Date.now()
  await writeFile(getSessionPath(history.agent, history.sessionId), JSON.stringify(history, null, 2))
  await setCurrentSessionId(history.agent, history.sessionId)
}

export async function listSessions(agent: AgentType): Promise<string[]> {
  try {
    const files = await readdir(getAgentDir(agent))
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))
  } catch {
    return []
  }
}

export async function clearHistory(agent: AgentType, sessionId?: string): Promise<void> {
  const { unlink } = await import("node:fs/promises")

  const targetSessionId = sessionId || await getCurrentSessionId(agent)
  if (targetSessionId) {
    try {
      await unlink(getSessionPath(agent, targetSessionId))
    } catch {
      // File doesn't exist
    }
  }
}

export function createHistory(agent: AgentType, sessionId: string): ChatHistory {
  return {
    agent,
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
}

export function addUserMessage(history: ChatHistory, content: string): StoredMessage {
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    role: "user",
    content,
  }
  history.messages.push(message)
  return message
}

export function addAssistantMessage(
  history: ChatHistory,
  content: string,
  tool?: StoredMessage["tool"]
): StoredMessage {
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    role: "assistant",
    content,
    tool,
  }
  history.messages.push(message)
  return message
}

export function updateToolResult(
  history: ChatHistory,
  toolId: string,
  result?: string,
  error?: string
): void {
  for (const msg of history.messages) {
    if (msg.tool?.id === toolId) {
      msg.tool.status = error ? "error" : "complete"
      msg.tool.result = result
      msg.tool.error = error
      break
    }
  }
}
