import { basename, dirname } from "@/lib/path-utils";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

/**
 * Build a tree structure from flat file and directory paths.
 * Directories are sorted before files, then alphabetically.
 */
export function buildTreeFromPaths(files: string[], directories: string[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();

  // Add all directories first
  for (const dir of directories) {
    nodeMap.set(dir, {
      name: basename(dir),
      path: dir,
      type: "directory",
      children: [],
    });
  }

  // Add all files
  for (const file of files) {
    nodeMap.set(file, {
      name: basename(file),
      path: file,
      type: "file",
    });
  }

  // Build parent-child relationships
  const rootNodes: TreeNode[] = [];

  for (const [path, node] of nodeMap) {
    const parentPath = dirname(path);

    if (parentPath === "" || parentPath === "/") {
      // Root level item
      rootNodes.push(node);
    } else {
      // Find parent and add as child
      const parent = nodeMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      } else {
        // Parent doesn't exist (shouldn't happen with proper data), add to root
        rootNodes.push(node);
      }
    }
  }

  return sortTreeNodes(rootNodes);
}

/**
 * Build a tree from a flat list of file paths (extracts directories automatically).
 * Useful for tool results that only return file paths.
 */
export function buildTreeFromFilePaths(filePaths: string[]): TreeNode[] {
  const directories = new Set<string>();

  // Extract all directory paths from file paths
  for (const filePath of filePaths) {
    let dir = dirname(filePath);
    while (dir && dir !== "/" && dir !== "" && dir !== ".") {
      directories.add(dir);
      dir = dirname(dir);
    }
  }

  return buildTreeFromPaths(filePaths, Array.from(directories));
}

/**
 * Sort tree nodes: directories first, then alphabetically.
 * Recursively sorts children.
 */
function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  const sorted = nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const node of sorted) {
    if (node.children) {
      node.children = sortTreeNodes(node.children);
    }
  }

  return sorted;
}
