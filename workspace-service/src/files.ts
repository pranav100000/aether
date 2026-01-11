import { readdir, stat, mkdir, rm, rename } from "fs/promises";
import { join, relative } from "path";

// Constants matching Go implementation
export const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
export const WORKING_DIR = process.env.PROJECT_CWD || "/home/coder/project";

// Hidden entries to skip when listing (matches Go's HiddenEntries)
const HIDDEN_ENTRIES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
  "dist",
  "build",
  ".next",
  ".cache",
  ".DS_Store",
  "Thumbs.db",
  "lost+found",
]);

// Types matching Go's SFTP types exactly
export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  modified: string; // ISO timestamp
}

export interface FileInfo {
  path: string;
  content?: string;
  size: number;
  modified: string; // ISO timestamp
}

export interface DirListing {
  path: string;
  entries: FileEntry[];
}

export interface FileTree {
  paths: string[];
  directories: string[];
}

// Resolve path relative to working directory, prevent path traversal
export function resolvePath(path: string): string {
  // Normalize the path
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const fullPath = join(WORKING_DIR, normalized);

  // Ensure the resolved path is within WORKING_DIR
  if (!fullPath.startsWith(WORKING_DIR)) {
    throw new Error("Invalid path: path traversal detected");
  }

  return fullPath;
}

// Check if content appears to be binary (contains null bytes)
export function isBinaryContent(content: Buffer): boolean {
  // Check first 8KB for null bytes
  const checkLength = Math.min(content.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (content[i] === 0) {
      return true;
    }
  }
  return false;
}

// List all files recursively (for file tree)
export async function listTree(): Promise<FileTree> {
  const paths: string[] = [];
  const directories: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden entries
      if (HIDDEN_ENTRIES.has(entry.name)) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relativePath = "/" + relative(WORKING_DIR, fullPath);

      if (entry.isDirectory()) {
        directories.push(relativePath);
        await walk(fullPath);
      } else {
        paths.push(relativePath);
      }
    }
  }

  await walk(WORKING_DIR);

  // Sort for consistent output
  paths.sort();
  directories.sort();

  return { paths, directories };
}

// List directory or read file
export async function listOrRead(path: string): Promise<DirListing | FileInfo> {
  const fullPath = resolvePath(path);
  const stats = await stat(fullPath);

  if (stats.isDirectory()) {
    return listDirectory(path);
  } else {
    return readFile(path);
  }
}

// List directory contents
export async function listDirectory(path: string): Promise<DirListing> {
  const fullPath = resolvePath(path);
  const entries = await readdir(fullPath, { withFileTypes: true });

  const fileEntries: FileEntry[] = [];

  for (const entry of entries) {
    // Skip hidden entries
    if (HIDDEN_ENTRIES.has(entry.name)) {
      continue;
    }

    const entryPath = join(fullPath, entry.name);
    const entryStats = await stat(entryPath);

    fileEntries.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size: entry.isDirectory() ? undefined : entryStats.size,
      modified: entryStats.mtime.toISOString(),
    });
  }

  // Sort: directories first, then alphabetically
  fileEntries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: path.startsWith("/") ? path : `/${path}`,
    entries: fileEntries,
  };
}

// Read file contents
export async function readFile(path: string): Promise<FileInfo> {
  const fullPath = resolvePath(path);
  const stats = await stat(fullPath);

  if (stats.isDirectory()) {
    throw new Error("Path is a directory, not a file");
  }

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  const file = Bun.file(fullPath);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isBinaryContent(buffer)) {
    throw new Error("Cannot read binary file");
  }

  return {
    path: path.startsWith("/") ? path : `/${path}`,
    content: buffer.toString("utf-8"),
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

// Write file contents
export async function writeFile(path: string, content: string): Promise<FileInfo> {
  const fullPath = resolvePath(path);

  if (content.length > MAX_FILE_SIZE) {
    throw new Error(`Content too large: ${content.length} bytes (max ${MAX_FILE_SIZE})`);
  }

  // Check for binary content (null bytes)
  if (content.includes("\0")) {
    throw new Error("Cannot write binary content");
  }

  // Create parent directories if needed
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await mkdir(parentDir, { recursive: true });

  // Write the file
  await Bun.write(fullPath, content);

  const stats = await stat(fullPath);

  return {
    path: path.startsWith("/") ? path : `/${path}`,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

// Create directory
export async function createDirectory(path: string): Promise<void> {
  const fullPath = resolvePath(path);
  await mkdir(fullPath, { recursive: true });
}

// Delete file or directory
export async function deleteFile(path: string): Promise<void> {
  const fullPath = resolvePath(path);
  await rm(fullPath, { recursive: true });
}

// Rename/move file or directory
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const fullOldPath = resolvePath(oldPath);
  const fullNewPath = resolvePath(newPath);

  // Create parent directories for new path if needed
  const parentDir = fullNewPath.substring(0, fullNewPath.lastIndexOf("/"));
  await mkdir(parentDir, { recursive: true });

  await rename(fullOldPath, fullNewPath);
}
