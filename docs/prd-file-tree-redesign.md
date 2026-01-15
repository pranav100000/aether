# PRD: File Tree Architecture Redesign

## Overview

Redesign the file tree system to load all files on startup and use websocket for incremental updates, enabling instant @ mention search and eliminating wasteful full-tree refreshes.

## Problem Statement

### Current Issues

1. **@ mentions only work for discovered files** - The autocomplete only searches files that have been preloaded (2 directory levels deep). Files in deeper directories are invisible to @ search until the user manually expands those directories.

2. **Full tree refresh on every file change** - When any file is created, modified, or deleted, the entire file tree is re-fetched via REST API. This causes unnecessary network requests, UI flicker, and poor performance.

3. **Multiple API calls for navigation** - Each directory expansion triggers a separate HTTP request. Navigating a deep directory structure requires many sequential requests.

4. **Duplicated code** - `HIDDEN_ENTRIES` (node_modules, .git, etc.) is defined in 3 separate files, creating maintenance burden.

### Current Architecture

```
User expands directory
    └─> Frontend calls GET /projects/:id/files?path=/foo
        └─> Backend SFTP lists single directory
            └─> Returns entries for that directory only

File changes on VM
    └─> inotifywait sends websocket event
        └─> Frontend increments refreshTrigger
            └─> FileTree re-fetches entire root directory
                └─> All expanded state is preserved but data re-fetched
```

## Proposed Solution

### New Architecture (Inspired by Replit)

```
Project loads
    └─> Frontend calls GET /projects/:id/files/tree (once)
        └─> Backend recursively walks entire project via SFTP
            └─> Returns flat arrays: { paths: [...], directories: [...] }
                └─> Frontend stores in FileTreeContext
                    └─> @ mentions search complete list instantly
                    └─> FileTree derives tree structure client-side

File changes on VM
    └─> inotifywait sends websocket event { action, path }
        └─> Frontend updates FileTreeContext incrementally
            └─> Add path on "create", remove on "delete"
                └─> UI re-renders affected parts only
```

### Key Benefits

1. **Instant @ mention search** - All files available immediately, no preloading needed
2. **No full refreshes** - Websocket events update state incrementally
3. **Single API call** - One request loads entire file structure
4. **Simpler code** - Delete preload logic, refresh triggers, duplicate constants

## Detailed Requirements

### Backend

#### New Endpoint: `GET /projects/:id/files/tree`

**Request:**

```
GET /projects/:id/files/tree
Authorization: Bearer <token>
```

**Response:**

```json
{
  "paths": [
    "/src/index.ts",
    "/src/lib/api.ts",
    "/src/components/Button.tsx",
    "/package.json",
    "/tsconfig.json"
  ],
  "directories": ["/src", "/src/lib", "/src/components"]
}
```

**Behavior:**

- Recursively walk `/home/coder/project` via SFTP
- Filter hidden entries server-side: `node_modules`, `.git`, `__pycache__`, `.venv`, `venv`, `.env`, `dist`, `build`, `.next`, `.cache`, `.DS_Store`, `Thumbs.db`, `lost+found`
- Return relative paths (strip `/home/coder/project` prefix)
- Paths are files only, directories are directories only
- No metadata (size, modified date) - paths only for minimal payload

**Error Cases:**

- 401: Unauthorized
- 404: Project not found
- 400: Project not running / no VM
- 500: SFTP connection failed

#### Existing Endpoints (No Changes)

These endpoints remain unchanged:

- `GET /projects/:id/files?path=...` - Read file content
- `PUT /projects/:id/files?path=...` - Write file
- `DELETE /projects/:id/files?path=...` - Delete file
- `POST /projects/:id/files/mkdir` - Create directory
- `POST /projects/:id/files/rename` - Rename/move

#### Websocket Messages (No Changes)

Existing `file_change` messages continue to work:

```json
{
  "type": "file_change",
  "action": "create" | "modify" | "delete",
  "path": "/src/newfile.ts"
}
```

### Frontend

#### FileTreeContext Changes

**New State:**

```typescript
interface FileTreeContextValue {
  allFiles: string[]; // All file paths
  directories: string[]; // All directory paths
  isLoading: boolean; // Initial load state
  error: string | null; // Load error
  searchFiles: (query: string, limit?: number) => string[];
  handleFileChange: (action: string, path: string) => void;
  refresh: () => Promise<void>; // Manual refresh if needed
}
```

**Removed:**

- `loadedDirs: Set<string>` - No longer tracking loaded directories
- `isPreloading: boolean` - No preloading
- `preloadDirectory()` - Deleted
- `addFiles()` - Replaced by initial load

**New Method:**

```typescript
const handleFileChange = (action: string, path: string) => {
  setAllFiles((prev) => {
    if (action === "create") {
      // Add if not exists
      return prev.includes(path) ? prev : [...prev, path].sort();
    } else if (action === "delete") {
      // Remove if exists
      return prev.filter((p) => p !== path);
    }
    return prev; // 'modify' doesn't change paths
  });

  // Also update directories if path is a directory
  // Determine by checking if any files have this as prefix
};
```

#### FileTree Component Changes

**New Behavior:**

- Consume `allFiles` and `directories` from FileTreeContext
- Derive tree structure client-side using `buildTreeFromPaths()`
- No API calls for directory listing
- Expansion state is local UI state only

**Helper Function:**

```typescript
interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

function buildTreeFromPaths(files: string[], directories: string[]): TreeNode[] {
  // Build tree structure from flat paths
  // Group by parent directory
  // Sort: directories first, then alphabetically
}
```

#### FileTreeItem Component Changes

**Removed:**

- `api.listFiles()` calls for loading children
- Loading state for directory expansion

**New Behavior:**

- Children are computed from paths, not fetched
- Expansion just toggles local state
- Instant expansion (no loading delay)

#### Workspace Component Changes

**Removed:**

- `fileTreeRefreshTrigger` state
- `handleFileChange` that increments trigger

**New:**

- Pass websocket `file_change` events to FileTreeContext
- Wire up `handleFileChange(action, path)` callback

#### API Layer Changes

**New Method:**

```typescript
async listFilesTree(projectId: string): Promise<{ paths: string[], directories: string[] }> {
  return apiRequest(`/projects/${projectId}/files/tree`)
}
```

#### Constants

**New File:** `frontend/src/constants/files.ts`

```typescript
export const HIDDEN_ENTRIES = new Set([
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
```

## Files to Modify

| File                                                 | Action | Description                  |
| ---------------------------------------------------- | ------ | ---------------------------- |
| `backend/sftp/client.go`                             | Modify | Add `ListAllFiles()` method  |
| `backend/handlers/files.go`                          | Modify | Add `ListTree()` handler     |
| `backend/main.go`                                    | Modify | Add `/files/tree` route      |
| `frontend/src/lib/api.ts`                            | Modify | Add `listFilesTree()` method |
| `frontend/src/constants/files.ts`                    | Create | Centralized `HIDDEN_ENTRIES` |
| `frontend/src/contexts/FileTreeContext.tsx`          | Modify | Major refactor               |
| `frontend/src/components/workspace/FileTree.tsx`     | Modify | Derive tree from paths       |
| `frontend/src/components/workspace/FileTreeItem.tsx` | Modify | Remove fetch calls           |
| `frontend/src/pages/Workspace.tsx`                   | Modify | Remove refresh trigger       |

## Code to Delete

1. `preloadDirectory()` function in FileTreeContext (~25 lines)
2. `loadedDirs` and `isPreloading` state in FileTreeContext
3. `fileTreeRefreshTrigger` state in Workspace
4. `loadRoot()` API fetch logic in FileTree
5. `api.listFiles()` calls in FileTreeItem for subdirectories
6. Duplicate `HIDDEN_ENTRIES` in FileTree.tsx, FileTreeItem.tsx, FileTreeContext.tsx

**Estimated lines deleted:** ~100-150 lines

## Performance Considerations

### Payload Size

- 10,000 files at ~50 characters average path = ~500KB
- Gzip compressed = ~50-100KB
- Acceptable for initial load

### Large Projects

For MVP, return all files. If projects exceed reasonable size:

- Most user projects are <5,000 files (excluding node_modules)
- Hidden entry filtering removes the largest directories
- Future: Add pagination if needed

### Memory Usage

- 10,000 paths in memory = ~1-2MB JavaScript heap
- Negligible compared to editor, terminal, etc.

## Testing Plan

### Manual Testing

1. **Initial load** - Start project, verify file tree shows all files
2. **@ mention search** - Type `@` in chat, search for file in deep directory, verify it appears
3. **File creation** - Create file via terminal, verify it appears in tree without refresh
4. **File deletion** - Delete file via terminal, verify it disappears from tree
5. **Directory creation** - Create directory, verify it appears
6. **Network tab** - Verify single `/files/tree` call, no `/files?path=` calls during navigation

### Edge Cases

1. **Empty project** - Should show empty tree
2. **Project not running** - Should show appropriate error
3. **Very deep nesting** - 20+ levels should work
4. **Special characters in paths** - Spaces, unicode should work
5. **Rapid file changes** - Multiple quick changes should all be reflected

## Future Enhancements (Out of Scope)

1. **Virtualization** - Only render visible tree rows (Replit saw 20x improvement)
2. **Local caching** - Persist tree to localStorage for instant load on return visit
3. **Incremental initial load** - Stream paths for very large projects
4. **File metadata on demand** - Fetch size/modified when hovering or in details panel

## Success Metrics

1. **@ mention coverage** - 100% of project files searchable (vs ~20% with 2-level preload)
2. **API calls reduced** - 1 call on load vs N calls for N directories expanded
3. **No refresh flicker** - File changes update incrementally
4. **Code reduction** - Net deletion of 100+ lines

## Timeline

This is a focused refactor touching ~10 files. Implementation phases:

1. **Phase 1: Backend** - New endpoint and SFTP method
2. **Phase 2: Frontend context** - Refactor FileTreeContext
3. **Phase 3: Frontend components** - Update FileTree, FileTreeItem
4. **Phase 4: Integration** - Wire websocket, remove old code
5. **Phase 5: Cleanup** - Centralize constants, delete dead code

## Open Questions

None - design is straightforward and aligned with user requirements.
