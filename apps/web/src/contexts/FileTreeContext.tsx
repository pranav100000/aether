import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { basename, dirname, isChildOrEqualPath } from "@/lib/path-utils";
import type { FileOperationsProvider } from "@/hooks/useWorkspaceConnection";

/** Get all parent directories for a path (excluding root) */
function getParentDirectories(filePath: string): string[] {
  const parents: string[] = [];
  let current = dirname(filePath);
  while (current && current !== "/" && current !== ".") {
    parents.push(current);
    current = dirname(current);
  }
  return parents;
}

/** Add paths to a set and return sorted array, or original if unchanged */
function addToSortedSet(prev: string[], toAdd: string[]): string[] {
  const newSet = new Set(prev);
  for (const item of toAdd) {
    newSet.add(item);
  }
  if (newSet.size === prev.length) return prev;
  return Array.from(newSet).sort();
}

interface FileTreeContextValue {
  // All file paths in the project
  allFiles: string[];
  // All directory paths in the project
  directories: string[];
  // Loading state for initial fetch
  isLoading: boolean;
  // Error state
  error: string | null;
  // Search files by query (fuzzy match on path)
  searchFiles: (query: string, limit?: number) => string[];
  // Handle file change from websocket or UI
  handleFileChange: (action: string, path: string, isDirectory: boolean) => void;
  // Refresh the file tree (refetch from server)
  refresh: () => Promise<void>;
  // Create a new file (via WebSocket)
  createFile: (path: string) => Promise<void>;
  // Create a new directory (via WebSocket)
  createDirectory: (path: string) => Promise<void>;
  // Delete a file or directory (via WebSocket)
  deleteItem: (path: string, isDirectory: boolean) => Promise<void>;
  // Rename a file or directory (via WebSocket)
  renameItem: (oldPath: string, newPath: string, isDirectory: boolean) => Promise<void>;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function useFileTreeContext() {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error("useFileTreeContext must be used within a FileTreeProvider");
  }
  return context;
}

interface FileTreeProviderProps {
  projectId: string; // Kept for potential future use
  children: ReactNode;
  /** WebSocket file operations provider - required for all file operations */
  fileOps?: FileOperationsProvider;
  /** Callback to receive the handleFileChange function for external file change notifications */
  onHandleFileChangeReady?: (
    handler: (action: string, path: string, isDirectory: boolean) => void
  ) => void;
}

export function FileTreeProvider({
  children,
  fileOps,
  onHandleFileChangeReady,
}: FileTreeProviderProps) {
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFileTree = useCallback(async () => {
    if (!fileOps) {
      setError("File operations not available");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const tree = await fileOps.listFilesTree();
      setAllFiles(tree.paths);
      setDirectories(tree.directories);
    } catch (err) {
      console.error("Failed to load file tree:", err);
      setError(err instanceof Error ? err.message : "Failed to load file tree");
    } finally {
      setIsLoading(false);
    }
  }, [fileOps]);

  // Load file tree on mount
  useEffect(() => {
    loadFileTree();
  }, [loadFileTree]);

  const handleFileChange = useCallback((action: string, path: string, isDirectory: boolean) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const parents = getParentDirectories(normalizedPath);

    if (action === "create" || action === "modify") {
      if (isDirectory) {
        setDirectories((prev) => addToSortedSet(prev, [normalizedPath, ...parents]));
      } else {
        if (parents.length > 0) {
          setDirectories((prev) => addToSortedSet(prev, parents));
        }
        setAllFiles((prev) => addToSortedSet(prev, [normalizedPath]));
      }
    } else if (action === "delete") {
      setAllFiles((prev) => prev.filter((p) => !isChildOrEqualPath(p, normalizedPath)));
      setDirectories((prev) => prev.filter((p) => !isChildOrEqualPath(p, normalizedPath)));
    }
  }, []);

  // Notify parent component that handleFileChange is ready
  useEffect(() => {
    if (onHandleFileChangeReady) {
      onHandleFileChangeReady(handleFileChange);
    }
  }, [onHandleFileChangeReady, handleFileChange]);

  const refresh = useCallback(async () => {
    await loadFileTree();
  }, [loadFileTree]);

  const createFile = useCallback(
    async (path: string): Promise<void> => {
      if (!fileOps) {
        throw new Error("File operations not available");
      }
      await fileOps.writeFile(path, "");
      handleFileChange("create", path, false);
    },
    [fileOps, handleFileChange]
  );

  const createDirectory = useCallback(
    async (path: string): Promise<void> => {
      if (!fileOps) {
        throw new Error("File operations not available");
      }
      await fileOps.mkdir(path);
      handleFileChange("create", path, true);
    },
    [fileOps, handleFileChange]
  );

  const deleteItem = useCallback(
    async (path: string, isDirectory: boolean): Promise<void> => {
      if (!fileOps) {
        throw new Error("File operations not available");
      }
      await fileOps.deleteFile(path);
      handleFileChange("delete", path, isDirectory);
    },
    [fileOps, handleFileChange]
  );

  const renameItem = useCallback(
    async (oldPath: string, newPath: string, isDirectory: boolean): Promise<void> => {
      if (!fileOps) {
        throw new Error("File operations not available");
      }
      await fileOps.renameFile(oldPath, newPath);
      handleFileChange("delete", oldPath, isDirectory);
      handleFileChange("create", newPath, isDirectory);
    },
    [fileOps, handleFileChange]
  );

  const searchFiles = useCallback(
    (query: string, limit: number = 20): string[] => {
      if (!query) {
        return allFiles.slice(0, limit);
      }

      const lowerQuery = query.toLowerCase();

      return allFiles
        .filter((path) => {
          const filename = basename(path).toLowerCase();
          const pathLower = path.toLowerCase();
          // Match filename first, then full path
          return filename.includes(lowerQuery) || pathLower.includes(lowerQuery);
        })
        .sort((a, b) => {
          // Prioritize exact filename matches
          const aName = basename(a).toLowerCase();
          const bName = basename(b).toLowerCase();
          const aExact = aName === lowerQuery;
          const bExact = bName === lowerQuery;
          if (aExact !== bExact) return aExact ? -1 : 1;
          // Then by path length (shorter = more relevant)
          return a.length - b.length;
        })
        .slice(0, limit);
    },
    [allFiles]
  );

  return (
    <FileTreeContext.Provider
      value={{
        allFiles,
        directories,
        isLoading,
        error,
        searchFiles,
        handleFileChange,
        refresh,
        createFile,
        createDirectory,
        deleteItem,
        renameItem,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}
