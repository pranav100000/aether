import { stat, readdir, mkdir, rm, rename } from "fs/promises"
import { join, relative, dirname } from "path"
import { logger } from "../logging"
import type {
  FileOperationRequest,
  FileOperationResponse,
  FileReadRequest,
  FileWriteRequest,
  FileListRequest,
  FileListTreeRequest,
  FileMkdirRequest,
  FileDeleteRequest,
  FileRenameRequest,
  FileStatRequest,
  FileReadResponse,
  FileWriteResponse,
  FileListResponse,
  FileListTreeResponse,
  FileMkdirResponse,
  FileDeleteResponse,
  FileRenameResponse,
  FileStatResponse,
  FileErrorResponse,
  FileErrorCode,
  FileEntry,
} from "./types"

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const BINARY_CHECK_LENGTH = 8000 // Check first 8000 bytes for binary detection

export interface FileOperationsConfig {
  projectDir: string
}

/**
 * Handles file operations over WebSocket.
 * Replaces SFTP-based file operations with direct filesystem access.
 */
export class FileOperations {
  private projectDir: string
  private log = logger.child({ channel: "fileOps" })

  constructor(config: FileOperationsConfig) {
    this.projectDir = config.projectDir
  }

  /**
   * Handle incoming file operation request.
   * Returns a response message to send back to client.
   */
  async handleRequest(request: FileOperationRequest): Promise<FileOperationResponse> {
    const { requestId, type } = request

    this.log.debug("handling file operation", { type, requestId })

    try {
      switch (type) {
        case "read":
          return await this.read(request)
        case "write":
          return await this.write(request)
        case "list":
          return await this.list(request)
        case "listTree":
          return await this.listTree(request)
        case "mkdir":
          return await this.mkdir(request)
        case "delete":
          return await this.delete(request)
        case "rename":
          return await this.rename(request)
        case "stat":
          return await this.stat(request)
        default:
          return this.errorResponse(requestId, "INTERNAL_ERROR", `Unknown operation type: ${type}`)
      }
    } catch (err) {
      this.log.error("file operation failed", { type, requestId, error: String(err) })
      return this.handleError(requestId, err, request)
    }
  }

  /**
   * Resolve and validate path is within project directory.
   * Throws if path escapes project directory.
   */
  private resolvePath(path: string): string {
    // Normalize the path - remove .. segments and double slashes
    const cleaned = path.replace(/\/+/g, "/")

    // Handle relative vs absolute
    const resolved = cleaned.startsWith("/")
      ? join(this.projectDir, cleaned.slice(1))
      : join(this.projectDir, cleaned)

    // Security check: ensure path is within project directory
    const relativePath = relative(this.projectDir, resolved)
    if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
      throw new PathSecurityError(`Path escapes project directory: ${path}`)
    }

    return resolved
  }

  /**
   * Get relative path from project root (with leading slash)
   */
  private getRelativePath(fullPath: string): string {
    return "/" + relative(this.projectDir, fullPath)
  }

  /**
   * Detect binary content using null-byte heuristic.
   * Checks first BINARY_CHECK_LENGTH bytes for null bytes.
   */
  private detectBinary(bytes: Uint8Array): boolean {
    const checkLength = Math.min(bytes.length, BINARY_CHECK_LENGTH)
    for (let i = 0; i < checkLength; i++) {
      if (bytes[i] === 0) return true
    }
    return false
  }

  /**
   * Read file with automatic binary detection.
   */
  private async read(request: FileReadRequest): Promise<FileReadResponse | FileErrorResponse> {
    const { requestId, path } = request
    const fullPath = this.resolvePath(path)

    // Check if exists and is file
    const stats = await stat(fullPath)
    if (stats.isDirectory()) {
      return this.errorResponse(requestId, "IS_DIRECTORY", `Path is a directory: ${path}`, path)
    }

    if (stats.size > MAX_FILE_SIZE) {
      return this.errorResponse(
        requestId,
        "FILE_TOO_LARGE",
        `File size ${stats.size} exceeds maximum ${MAX_FILE_SIZE}`,
        path
      )
    }

    // Read file using Bun's native file API
    const file = Bun.file(fullPath)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    const isBinary = this.detectBinary(bytes)

    // Encode content based on binary detection
    let content: string
    let encoding: "utf8" | "base64"

    if (isBinary) {
      content = Buffer.from(bytes).toString("base64")
      encoding = "base64"
    } else {
      content = new TextDecoder().decode(bytes)
      encoding = "utf8"
    }

    this.log.debug("file read", { path, size: stats.size, isBinary })

    return {
      channel: "files",
      type: "read",
      requestId,
      success: true,
      path,
      content,
      encoding,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      isBinary,
    }
  }

  /**
   * Write file with automatic parent directory creation.
   */
  private async write(request: FileWriteRequest): Promise<FileWriteResponse | FileErrorResponse> {
    const { requestId, path, content, encoding } = request
    const fullPath = this.resolvePath(path)

    // Decode content if base64
    let data: Uint8Array
    if (encoding === "base64") {
      data = new Uint8Array(Buffer.from(content, "base64"))
    } else {
      data = new TextEncoder().encode(content)
    }

    // Check size limit
    if (data.length > MAX_FILE_SIZE) {
      return this.errorResponse(
        requestId,
        "FILE_TOO_LARGE",
        `Content size ${data.length} exceeds maximum ${MAX_FILE_SIZE}`,
        path
      )
    }

    // Ensure parent directory exists
    const parentDir = dirname(fullPath)
    await mkdir(parentDir, { recursive: true })

    // Write file using Bun's native file API
    await Bun.write(fullPath, data)

    // Get updated stats
    const stats = await stat(fullPath)

    this.log.debug("file written", { path, size: stats.size })

    return {
      channel: "files",
      type: "write",
      requestId,
      success: true,
      path,
      size: stats.size,
      modified: stats.mtime.toISOString(),
    }
  }

  /**
   * List directory contents.
   */
  private async list(request: FileListRequest): Promise<FileListResponse | FileErrorResponse> {
    const { requestId, path } = request
    const fullPath = this.resolvePath(path)

    const stats = await stat(fullPath)
    if (!stats.isDirectory()) {
      return this.errorResponse(requestId, "IS_FILE", `Path is not a directory: ${path}`, path)
    }

    const dirEntries = await readdir(fullPath, { withFileTypes: true })
    const entries: FileEntry[] = []

    for (const entry of dirEntries) {
      // Skip hidden files and common ignore patterns
      if (this.shouldIgnore(entry.name)) continue

      const entryPath = join(fullPath, entry.name)
      try {
        const entryStats = await stat(entryPath)
        entries.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: entryStats.size,
          modified: entryStats.mtime.toISOString(),
        })
      } catch {
        // Skip entries we can't stat
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    this.log.debug("directory listed", { path, entries: entries.length })

    return {
      channel: "files",
      type: "list",
      requestId,
      success: true,
      path,
      entries,
    }
  }

  /**
   * List all files in directory tree (parallel walking for performance).
   */
  private async listTree(request: FileListTreeRequest): Promise<FileListTreeResponse | FileErrorResponse> {
    const { requestId } = request

    const paths: string[] = []
    const directories: string[] = []

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      const subDirPromises: Promise<void>[] = []

      for (const entry of entries) {
        // Skip hidden and ignored patterns
        if (this.shouldIgnore(entry.name)) continue

        const fullPath = join(dir, entry.name)
        const relativePath = this.getRelativePath(fullPath)

        if (entry.isDirectory()) {
          directories.push(relativePath)
          // Walk subdirectories in parallel
          subDirPromises.push(walk(fullPath))
        } else {
          paths.push(relativePath)
        }
      }

      await Promise.all(subDirPromises)
    }

    await walk(this.projectDir)

    this.log.debug("tree listed", { files: paths.length, directories: directories.length })

    return {
      channel: "files",
      type: "listTree",
      requestId,
      success: true,
      paths,
      directories,
    }
  }

  /**
   * Create directory (with recursive parent creation).
   */
  private async mkdir(request: FileMkdirRequest): Promise<FileMkdirResponse | FileErrorResponse> {
    const { requestId, path } = request
    const fullPath = this.resolvePath(path)

    await mkdir(fullPath, { recursive: true })

    this.log.debug("directory created", { path })

    return {
      channel: "files",
      type: "mkdir",
      requestId,
      success: true,
      path,
    }
  }

  /**
   * Delete file or directory (recursive for directories).
   */
  private async delete(request: FileDeleteRequest): Promise<FileDeleteResponse | FileErrorResponse> {
    const { requestId, path } = request
    const fullPath = this.resolvePath(path)

    // Check if exists
    await stat(fullPath) // Throws if not exists

    // Remove with recursive option for directories
    await rm(fullPath, { recursive: true, force: true })

    this.log.debug("file/directory deleted", { path })

    return {
      channel: "files",
      type: "delete",
      requestId,
      success: true,
      path,
    }
  }

  /**
   * Rename/move file or directory.
   */
  private async rename(request: FileRenameRequest): Promise<FileRenameResponse | FileErrorResponse> {
    const { requestId, oldPath, newPath } = request
    const fullOldPath = this.resolvePath(oldPath)
    const fullNewPath = this.resolvePath(newPath)

    // Check source exists
    await stat(fullOldPath) // Throws if not exists

    // Ensure parent directory of destination exists
    const parentDir = dirname(fullNewPath)
    await mkdir(parentDir, { recursive: true })

    // Rename
    await rename(fullOldPath, fullNewPath)

    this.log.debug("file/directory renamed", { oldPath, newPath })

    return {
      channel: "files",
      type: "rename",
      requestId,
      success: true,
      oldPath,
      newPath,
    }
  }

  /**
   * Get file/directory stats.
   */
  private async stat(request: FileStatRequest): Promise<FileStatResponse | FileErrorResponse> {
    const { requestId, path } = request
    const fullPath = this.resolvePath(path)

    const stats = await stat(fullPath)

    this.log.debug("stat retrieved", { path, isDirectory: stats.isDirectory() })

    return {
      channel: "files",
      type: "stat",
      requestId,
      success: true,
      path,
      fileType: stats.isDirectory() ? "directory" : "file",
      size: stats.size,
      modified: stats.mtime.toISOString(),
    }
  }

  /**
   * Check if a file/directory name should be ignored.
   */
  private shouldIgnore(name: string): boolean {
    const ignorePatterns = new Set([
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
      ".DS_Store",
    ])

    // Ignore patterns in set
    if (ignorePatterns.has(name)) return true

    // Ignore hidden files starting with . (except common config files)
    if (name.startsWith(".")) {
      // Allow common config files
      const allowedDotFiles = new Set([
        ".env",
        ".env.local",
        ".env.development",
        ".env.production",
        ".eslintrc",
        ".eslintrc.js",
        ".eslintrc.json",
        ".prettierrc",
        ".prettierrc.js",
        ".prettierrc.json",
        ".babelrc",
        ".editorconfig",
        ".gitignore",
        ".npmrc",
        ".nvmrc",
        ".dockerignore",
      ])
      return !allowedDotFiles.has(name)
    }

    return false
  }

  /**
   * Create error response.
   */
  private errorResponse(
    requestId: string,
    code: FileErrorCode,
    message: string,
    path?: string
  ): FileErrorResponse {
    return {
      channel: "files",
      type: "error",
      requestId,
      success: false,
      error: message,
      code,
      path,
    }
  }

  /**
   * Handle and categorize errors.
   */
  private handleError(
    requestId: string,
    err: unknown,
    request: FileOperationRequest
  ): FileErrorResponse {
    // Path security error
    if (err instanceof PathSecurityError) {
      return this.errorResponse(requestId, "INVALID_PATH", err.message)
    }

    // Get path from request if available
    const path = "path" in request ? request.path : undefined

    // Node.js fs errors
    if (err && typeof err === "object" && "code" in err) {
      const fsErr = err as NodeJS.ErrnoException
      switch (fsErr.code) {
        case "ENOENT":
          return this.errorResponse(requestId, "NOT_FOUND", `Path not found: ${path}`, path)
        case "EACCES":
        case "EPERM":
          return this.errorResponse(requestId, "PERMISSION_DENIED", `Permission denied: ${path}`, path)
        case "EISDIR":
          return this.errorResponse(requestId, "IS_DIRECTORY", `Path is a directory: ${path}`, path)
        case "ENOTDIR":
          return this.errorResponse(requestId, "IS_FILE", `Path is not a directory: ${path}`, path)
        case "EEXIST":
          return this.errorResponse(requestId, "PATH_EXISTS", `Path already exists: ${path}`, path)
      }
    }

    // Unknown error
    const message = err instanceof Error ? err.message : String(err)
    return this.errorResponse(requestId, "INTERNAL_ERROR", message, path)
  }
}

/**
 * Error thrown when path validation fails.
 */
class PathSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathSecurityError"
  }
}
