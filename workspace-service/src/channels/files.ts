import { watch, type FSWatcher } from "fs"
import { readdir, stat } from "fs/promises"
import { join, relative } from "path"
import type { FileChangeMessage } from "./types"

export interface FileWatcherConfig {
  projectDir: string
  debounceMs?: number
}

export class FileWatcher {
  private watchers: FSWatcher[] = []
  private sendFn: ((msg: FileChangeMessage) => void) | null = null
  private projectDir: string
  private debounceMs: number
  private pendingEvents: Map<string, NodeJS.Timeout> = new Map()

  constructor(config: FileWatcherConfig) {
    this.projectDir = config.projectDir
    this.debounceMs = config.debounceMs ?? 100
  }

  /**
   * Initialize file watcher and start watching
   */
  async initialize(send: (msg: FileChangeMessage) => void): Promise<void> {
    this.sendFn = send

    try {
      await this.watchDirectory(this.projectDir)
      console.log(`[FileWatcher] Watching: ${this.projectDir}`)
    } catch (err) {
      console.error("[FileWatcher] Failed to initialize:", err)
    }
  }

  /**
   * Recursively watch a directory
   */
  private async watchDirectory(dirPath: string): Promise<void> {
    // Watch this directory
    const watcher = watch(dirPath, { persistent: false }, (eventType, filename) => {
      if (filename) {
        this.handleEvent(eventType, join(dirPath, filename))
      }
    })

    watcher.on("error", (err) => {
      console.error(`[FileWatcher] Error watching ${dirPath}:`, err)
    })

    this.watchers.push(watcher)

    // Recursively watch subdirectories
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        // Skip node_modules, .git, and other common ignore patterns
        if (this.shouldIgnore(entry.name)) continue

        if (entry.isDirectory()) {
          await this.watchDirectory(join(dirPath, entry.name))
        }
      }
    } catch {
      // Directory might not exist or be readable
    }
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(name: string): boolean {
    const ignorePatterns = [
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
    return ignorePatterns.includes(name) || name.startsWith(".")
  }

  /**
   * Handle file system event with debouncing
   */
  private handleEvent(eventType: string, fullPath: string): void {
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

      // If it's a new directory, start watching it
      if (isDirectory) {
        await this.watchDirectory(fullPath)
      }
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
   * Close all watchers
   */
  close(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []

    for (const timeout of this.pendingEvents.values()) {
      clearTimeout(timeout)
    }
    this.pendingEvents.clear()

    console.log("[FileWatcher] Closed")
  }
}
