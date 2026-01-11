import { watch, type FSWatcher } from "fs";
import type { ServerWebSocket } from "bun";

const WORKING_DIR = process.env.PROJECT_CWD || "/home/coder/project";

// Directories to ignore when watching for changes
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".aether",
  "__pycache__",
  ".cache",
  ".turbo",
]);

export interface EventsWSData {
  type: "events";
  userId: string;
}

interface FileChangeMessage {
  type: "file_change";
  action: "create" | "modify" | "delete";
  path: string;
}

const subscribers = new Set<ServerWebSocket<EventsWSData>>();
let watcher: FSWatcher | null = null;

function shouldIgnore(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

function startWatcher() {
  if (watcher) return;

  console.log(`[events] Starting file watcher on: ${WORKING_DIR}`);

  try {
    watcher = watch(WORKING_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename || shouldIgnore(filename)) return;

      // Normalize path to start with /
      const relativePath = "/" + filename;

      // Map fs.watch event types to our action types
      // "rename" can mean create, delete, or rename
      // "change" means modify
      const action: FileChangeMessage["action"] =
        eventType === "change" ? "modify" : "create";

      const message: FileChangeMessage = {
        type: "file_change",
        action,
        path: relativePath,
      };

      const jsonMessage = JSON.stringify(message);

      console.log(`[events] File change: ${action} ${relativePath}`);

      for (const ws of subscribers) {
        ws.send(jsonMessage);
      }
    });

    watcher.on("error", (err) => {
      console.error("[events] Watcher error:", err);
    });
  } catch (err) {
    console.error("[events] Failed to start watcher:", err);
  }
}

function stopWatcher() {
  if (watcher) {
    console.log("[events] Stopping file watcher");
    watcher.close();
    watcher = null;
  }
}

export function handleEventsOpen(ws: ServerWebSocket<EventsWSData>) {
  console.log(`[events] Client subscribed (total: ${subscribers.size + 1})`);
  subscribers.add(ws);

  // Start watcher if this is the first subscriber
  if (subscribers.size === 1) {
    startWatcher();
  }
}

export function handleEventsClose(ws: ServerWebSocket<EventsWSData>) {
  subscribers.delete(ws);
  console.log(`[events] Client unsubscribed (remaining: ${subscribers.size})`);

  // Stop watcher if no more subscribers
  if (subscribers.size === 0) {
    stopWatcher();
  }
}
