import { basename, dirname, extname, join } from "pathe"

// Re-export commonly used functions from pathe
export { basename, dirname, extname, join }

// Normalize path by removing trailing slashes
export function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/"
}

// Check if a path is a child of another path
export function isChildPath(child: string, parent: string): boolean {
  const normalizedChild = normalizePath(child)
  const normalizedParent = normalizePath(parent)
  return normalizedChild.startsWith(normalizedParent + "/")
}

// Check if a path is a child of or equal to another path
export function isChildOrEqualPath(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(normalizedParent + "/")
}
