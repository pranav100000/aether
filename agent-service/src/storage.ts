import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentType } from "./types";

// Store inside the project directory so it persists with the volume
// Use local path for development, absolute path for production
const STORAGE_DIR = process.env.STORAGE_DIR || "./data/.aether";

export interface StoredMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant" | "system";
  content: string;
  tool?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: string;
    result?: string;
    error?: string;
  };
}

export interface ChatHistory {
  agent: AgentType;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

function getAgentDir(agent: AgentType): string {
  return join(STORAGE_DIR, agent);
}

function getSessionPath(agent: AgentType, sessionId: string): string {
  return join(getAgentDir(agent), `${sessionId}.json`);
}

function getCurrentSessionPath(agent: AgentType): string {
  return join(getAgentDir(agent), "current");
}

async function getCurrentSessionId(agent: AgentType): Promise<string | null> {
  try {
    const currentPath = getCurrentSessionPath(agent);
    const sessionId = await readFile(currentPath, "utf-8");
    return sessionId.trim();
  } catch {
    return null;
  }
}

async function setCurrentSessionId(agent: AgentType, sessionId: string): Promise<void> {
  const agentDir = getAgentDir(agent);
  await mkdir(agentDir, { recursive: true });
  await writeFile(getCurrentSessionPath(agent), sessionId);
}

export async function loadHistory(agent: AgentType): Promise<ChatHistory | null> {
  const sessionId = await getCurrentSessionId(agent);
  if (!sessionId) {
    return null;
  }

  return loadSession(agent, sessionId);
}

export async function loadSession(agent: AgentType, sessionId: string): Promise<ChatHistory | null> {
  const path = getSessionPath(agent, sessionId);

  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as ChatHistory;
  } catch {
    return null;
  }
}

export async function saveHistory(history: ChatHistory): Promise<void> {
  const agentDir = getAgentDir(history.agent);
  await mkdir(agentDir, { recursive: true });

  const path = getSessionPath(history.agent, history.sessionId);
  history.updatedAt = Date.now();
  await writeFile(path, JSON.stringify(history, null, 2));

  // Update current session pointer
  await setCurrentSessionId(history.agent, history.sessionId);
}

export async function listSessions(agent: AgentType): Promise<string[]> {
  const agentDir = getAgentDir(agent);

  try {
    const files = await readdir(agentDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export async function clearHistory(agent: AgentType, sessionId?: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");

  if (sessionId) {
    // Clear specific session
    const path = getSessionPath(agent, sessionId);
    try {
      await unlink(path);
    } catch {
      // File doesn't exist, ignore
    }
  } else {
    // Clear current session
    const currentSessionId = await getCurrentSessionId(agent);
    if (currentSessionId) {
      const path = getSessionPath(agent, currentSessionId);
      try {
        await unlink(path);
      } catch {
        // File doesn't exist, ignore
      }
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
  };
}

export function addUserMessage(history: ChatHistory, content: string): StoredMessage {
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    role: "user",
    content,
  };
  history.messages.push(message);
  return message;
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
  };
  history.messages.push(message);
  return message;
}

export function updateToolResult(
  history: ChatHistory,
  toolId: string,
  result?: string,
  error?: string
): void {
  // Find the message with this tool and update it
  for (const msg of history.messages) {
    if (msg.tool?.id === toolId) {
      msg.tool.status = error ? "error" : "complete";
      msg.tool.result = result;
      msg.tool.error = error;
      break;
    }
  }
}
