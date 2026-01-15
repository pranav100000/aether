import { watch, type FSWatcher } from "fs"
import { stat } from "fs/promises"
import { join, relative } from "path"
import { logger } from "../logging"
import type { FileChangeMessage } from "./types"

export interface FileWatcherConfig {
  projectDir: string
  debounceMs?: number
}

/**
 * Patterns to ignore when watching files.
 * These are checked against each path segment.
 */
const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".next",
  ".cache",
  "dist",
  "build",
  ".turbo",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
]

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private sendFn: ((msg: FileChangeMessage) => void) | null = null
  private projectDir: string
  private debounceMs: number
  private pendingEvents: Map<string, NodeJS.Timeout> = new Map()
  private log = logger.child({ channel: "files" })

  constructor(config: FileWatcherConfig) {
    this.projectDir = config.projectDir
    this.debounceMs = config.debounceMs ?? 100
  }

  /**
   * Initialize file watcher with a SINGLE recursive watcher.
   * This is much more efficient than creating one watcher per directory.
   */
  async initialize(send: (msg: FileChangeMessage) => void): Promise<void> {
    this.sendFn = send

    // Use a single recursive watcher instead of one per directory
    // This dramatically reduces resource usage
    this.watcher = watch(
      this.projectDir,
      { persistent: false, recursive: true },
      (eventType: string, filename: string | null) => {
        if (filename) {
          this.handleEvent(eventType, join(this.projectDir, filename))
        }
      }
    )

    this.watcher.on("error", (err: Error) => {
      this.log.error("watch error", { dir: this.projectDir, error: String(err) })
    })

    this.log.info("watching", { dir: this.projectDir, recursive: true })
  }

  /**
   * Check if a path segment should be ignored
   */
  private shouldIgnoreSegment(name: string): boolean {
    return IGNORE_PATTERNS.includes(name) || name.startsWith(".")
  }

  /**
   * Check if a full path should be ignored.
   * Returns true if any segment of the path matches ignore patterns.
   */
  private shouldIgnorePath(fullPath: string): boolean {
    const relPath = relative(this.projectDir, fullPath)
    if (!relPath) return false // Don't ignore the root directory itself

    const parts = relPath.split("/")
    return parts.some((part: string) => this.shouldIgnoreSegment(part))
  }

  /**
   * Handle file system event with debouncing
   */
  private handleEvent(eventType: string, fullPath: string): void {
    // Skip events for ignored paths (e.g., node_modules, .git)
    if (this.shouldIgnorePath(fullPath)) {
      return
    }

    // Debounce events for the same path
    const existing = this.pendingEvents.get(fullPath)
    if (existing) {
      clearTimeout(existing)
    }

    const timeout = setTimeout(() => {
      this.pendingEvents.delete(fullPath)
      this.emitChange(fullPath)
    }, this.debounceMs)

    this.pendingEvents.set(fullPath, timeout)
  }

  /**
   * Emit a file change event
   */
  private async emitChange(fullPath: string): Promise<void> {
    const relPath = "/" + relative(this.projectDir, fullPath)

    // Check if file exists to determine action
    let action: "create" | "modify" | "delete"
    let isDirectory = false

    try {
      const stats = await stat(fullPath)
      isDirectory = stats.isDirectory()
      // We can't distinguish create from modify with basic fs.watch
      // So we'll report all existing files as "modify"
      action = "modify"
    } catch {
      // File doesn't exist, must be deleted
      action = "delete"
    }

    this.send(relPath, action, isDirectory)
  }

  /**
   * Send file change message
   */
  private send(path: string, action: "create" | "modify" | "delete", isDirectory: boolean): void {
    this.sendFn?.({
      channel: "files",
      type: "change",
      action,
      path,
      isDirectory,
    })
  }

  /**
   * Close the watcher
   */
  close(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }

    for (const timeout of this.pendingEvents.values()) {
      clearTimeout(timeout)
    }
    this.pendingEvents.clear()

    this.log.info("closed")
  }
}
