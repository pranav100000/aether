# Phase 3 PRD: Editor & Preview

**Project:** aether (working title)
**Phase:** 3 of 5
**Timeline:** Weeks 5-6
**Goal:** Make it useful — add file editing, file tree, and port forwarding so users can actually build and preview web apps

---

## Overview

Phase 2 gave us a terminal. Phase 3 makes it a real development environment. By the end of this phase, users can:

1. Browse files in their project
2. Open, edit, and save files with syntax highlighting
3. Run a dev server and preview it in the browser
4. Have their files persist across VM restarts

This is where the product becomes genuinely useful for building things, not just running commands.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| File tree load time | <1 second for typical project |
| File save round-trip | <500ms perceived |
| Editor responsiveness | No lag on typing |
| Preview URL availability | <3 seconds after port opens |
| File persistence | 100% — no data loss on VM stop/restart |

---

## Technical Requirements

### 1. File System Access

Expose the VM's file system to the frontend.

**Approach:** SFTP over the existing SSH connection.

**Backend endpoints:**

```
GET    /projects/:id/files?path=/         List directory
GET    /projects/:id/files?path=/foo.js   Get file contents
PUT    /projects/:id/files?path=/foo.js   Write file contents
POST   /projects/:id/files/mkdir          Create directory
DELETE /projects/:id/files?path=/foo.js   Delete file/directory
POST   /projects/:id/files/rename         Rename/move file
```

**List directory response:**
```json
{
  "path": "/home/coder/project",
  "entries": [
    {"name": "src", "type": "directory", "modified": "2024-01-15T..."},
    {"name": "package.json", "type": "file", "size": 1234, "modified": "2024-01-15T..."},
    {"name": "node_modules", "type": "directory", "modified": "2024-01-14T..."}
  ]
}
```

**Get file response:**
```json
{
  "path": "/home/coder/project/src/index.js",
  "content": "console.log('hello');",
  "size": 21,
  "modified": "2024-01-15T..."
}
```

**Write file request:**
```json
{
  "content": "console.log('updated');"
}
```

**Implementation details:**
- Use SFTP subsystem over existing SSH connection
- Pool/reuse SFTP connections per project
- Working directory: `/home/coder/project`
- Hide `node_modules`, `.git`, etc. from tree by default (frontend filter)
- Max file size for editor: 1MB (show warning for larger files)
- Binary files: return base64 or reject with error

**Acceptance criteria:**
- Can list directories recursively
- Can read text files
- Can write files (creates if doesn't exist)
- Can create directories
- Can delete files and directories
- Can rename/move files
- Handles permissions errors gracefully
- Handles non-existent paths gracefully

---

### 2. CodeMirror Editor

Integrate CodeMirror 6 as the file editor.

**Features:**
- Syntax highlighting (auto-detect from extension)
- Line numbers
- Code folding
- Search/replace (Cmd+F / Ctrl+F)
- Multiple cursors
- Bracket matching
- Auto-indent
- Theming (dark mode)

**Supported languages (Phase 3):**
- JavaScript / TypeScript
- JSON
- HTML / CSS
- Python
- Go
- Markdown
- YAML / TOML
- Shell scripts

**Key bindings:**
- `Cmd/Ctrl + S` — Save file
- `Cmd/Ctrl + P` — Quick file open (stretch)
- `Cmd/Ctrl + F` — Find
- `Cmd/Ctrl + Shift + F` — Find in files (stretch)

**State management:**
- Track "dirty" state (unsaved changes)
- Warn before closing tab with unsaved changes
- Auto-save after 2 seconds of inactivity (debounced)

**Implementation:**

```typescript
// Key CodeMirror extensions
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
```

**Acceptance criteria:**
- Editor loads files correctly
- Syntax highlighting works for all supported languages
- Save works (Cmd+S and auto-save)
- Dirty indicator shows unsaved changes
- Warn on close with unsaved changes
- No perceptible lag while typing
- Theme matches overall app design

---

### 3. File Tree Component

Visual file browser in the sidebar.

**UI design:**

```
┌──────────────────────────────────────────────────────────────────┐
│  🔨 aether  /  my-api                         ● Running   [Stop]  │
├───────────────┬──────────────────────────────────────────────────┤
│ FILES         │  src/index.js                              [×]   │
│ ─────────     ├──────────────────────────────────────────────────│
│ ▼ src/        │  1  import express from 'express';               │
│    index.js ● │  2                                               │
│    utils.js   │  3  const app = express();                       │
│ ▶ tests/      │  4                                               │
│   package.json│  5  app.get('/', (req, res) => {                 │
│   README.md   │  6    res.send('Hello World');                   │
│               │  7  });                                          │
│               │  8                                               │
│ [+] New File  │  9  app.listen(3000);                            │
│               │                                                  │
├───────────────┼──────────────────────────────────────────────────┤
│ TERMINAL      │                                                  │
│ ─────────     │  coder@aether:~/project$ npm run dev              │
│               │  Server running on http://localhost:3000         │
│               │  █                                               │
└───────────────┴──────────────────────────────────────────────────┘
```

**Features:**
- Expandable/collapsible directories
- File icons based on type/extension
- Click to open file in editor
- Right-click context menu:
  - New File
  - New Folder
  - Rename
  - Delete
- Drag and drop to move files (stretch)
- Dirty indicator (dot) for unsaved files
- Filter out `node_modules`, `.git`, `__pycache__`, etc.

**Keyboard navigation:**
- Arrow keys to navigate
- Enter to open/toggle
- Delete to delete (with confirmation)

**Implementation details:**
- Lazy load directory contents (don't fetch entire tree upfront)
- Cache directory listings, invalidate on file operations
- Refresh button to force reload

**Acceptance criteria:**
- Tree displays project structure
- Can expand/collapse directories
- Clicking file opens in editor
- Can create new files and folders
- Can rename files
- Can delete files (with confirmation)
- Dirty indicator shows correctly
- Hidden files/folders are filtered

---

### 4. Port Forwarding / Preview

Let users access their running app via a public URL.

**Approach:** Fly Proxy (built into Fly Machines)

**How it works:**
1. User runs `npm run dev` on port 3000 in the VM
2. Fly Machine exposes port 3000 automatically
3. App is accessible at `https://{machine-id}.fly.dev:3000` or via Fly's proxy

**Better approach:** Custom subdomain per project

```
https://{project-id}.preview.aether.dev → VM port 3000
```

**Implementation:**
1. Run a proxy service (Caddy or nginx) that routes `*.preview.aether.dev`
2. Look up project by subdomain
3. Proxy to the project's Fly Machine internal IP
4. Handle SSL termination at the proxy

**Simpler v1:** Use Fly's built-in proxy

- Each Fly Machine gets a `.fly.dev` hostname
- Expose port 3000 (and 8080, 5173 for common dev servers)
- Tell user: "Your app is at https://{fly-machine-id}.fly.dev"

**UI integration:**
- Detect when user's app opens a port (parse terminal output or poll)
- Show "Preview" button that opens the URL
- Alternatively: embedded iframe preview pane (stretch)

**Preview panel (stretch):**

```
┌──────────────────────────────────────────────────────────────────┐
│  🔨 aether  /  my-api                         ● Running   [Stop]  │
├───────────────┬──────────────────────────────┬───────────────────┤
│ FILES         │  src/index.js          [×]   │ PREVIEW           │
│               │                              │ ─────────         │
│ ...           │  (editor content)            │ ┌───────────────┐ │
│               │                              │ │               │ │
│               │                              │ │  Hello World  │ │
│               │                              │ │               │ │
│               │                              │ └───────────────┘ │
│               │                              │ ↗ Open in new tab │
├───────────────┴──────────────────────────────┴───────────────────┤
│ TERMINAL                                                         │
└──────────────────────────────────────────────────────────────────┘
```

**Acceptance criteria:**
- User can access their running app via URL
- URL is displayed in the UI when port is detected
- Preview opens in new tab (or iframe if we do the stretch)
- Works for common ports (3000, 8080, 5173, 4000)

---

### 5. File Persistence

Ensure user files survive VM stop/restart.

**Approach:** Fly Volumes

**Setup:**
- Each project gets a Fly Volume (1GB default)
- Volume mounted at `/home/coder/project`
- Volume persists when machine is stopped
- Volume destroyed when project is deleted

**Database update:**
```sql
alter table projects add column fly_volume_id text;
```

**Machine creation flow (updated):**
1. Create Fly Volume (if not exists)
2. Store `fly_volume_id` in database
3. Create Fly Machine with volume attached
4. Store `fly_machine_id` in database

**Volume management:**
- Volumes are region-specific (machine must be in same region)
- Can't resize easily — start with 1GB, revisit later
- Volume orphan cleanup: destroy volumes without matching projects

**Acceptance criteria:**
- Files persist after stopping and starting project
- New project starts with empty `/home/coder/project`
- Deleting project destroys volume
- No orphaned volumes

---

## Updated Workspace Layout

Full workspace with all Phase 3 components:

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  Logo  /  Project Name              Status    [Preview] [Stop]   │
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                     │
│  SIDEBAR   │  EDITOR TABS                                        │
│            │  ┌─────────┬─────────┬────┐                        │
│  Files     │  │ index.js│ app.css │ ×  │                        │
│  ────────  │  └─────────┴─────────┴────┘                        │
│  ▼ src/    │                                                     │
│    index.js│  EDITOR CONTENT                                     │
│    app.css │                                                     │
│  package.  │  (CodeMirror)                                       │
│            │                                                     │
│  [+] New   │                                                     │
│            │                                                     │
├────────────┴─────────────────────────────────────────────────────┤
│  TERMINAL (collapsible)                                          │
│  $ npm run dev                                                   │
│  Server running on http://localhost:3000                         │
└──────────────────────────────────────────────────────────────────┘
```

**Layout behavior:**
- Sidebar width: resizable, default 250px
- Terminal height: resizable, default 200px, collapsible
- Editor tabs: scrollable if many open
- Responsive: on small screens, sidebar becomes a drawer

---

## File Structure Updates

```
aether/
├── backend/
│   ├── handlers/
│   │   ├── projects.go
│   │   ├── terminal.go
│   │   └── files.go          # NEW: file operations
│   ├── sftp/
│   │   └── client.go         # NEW: SFTP wrapper
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileTree.tsx      # NEW
│   │   │   ├── FileTreeItem.tsx  # NEW
│   │   │   ├── Editor.tsx        # NEW: CodeMirror wrapper
│   │   │   ├── EditorTabs.tsx    # NEW
│   │   │   ├── Terminal.tsx
│   │   │   ├── PreviewButton.tsx # NEW
│   │   │   ├── Sidebar.tsx       # NEW
│   │   │   └── Workspace.tsx     # NEW: layout container
│   │   ├── hooks/
│   │   │   ├── useFiles.ts       # NEW: file operations
│   │   │   └── useEditor.ts      # NEW: editor state
│   │   └── ...
│   └── ...
└── ...
```

---

## Dependencies

**Backend (new):**
- `github.com/pkg/sftp` — SFTP client

**Frontend (new):**
- `codemirror` — Core editor
- `@codemirror/lang-javascript`
- `@codemirror/lang-python`
- `@codemirror/lang-go`
- `@codemirror/lang-html`
- `@codemirror/lang-css`
- `@codemirror/lang-json`
- `@codemirror/lang-markdown`
- `@codemirror/lang-yaml`
- `@codemirror/theme-one-dark`
- `react-resizable-panels` — For resizable layout

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SFTP performance issues | Medium | Medium | Connection pooling, caching, lazy loading |
| Large files crash editor | Medium | Low | Set 1MB limit, show warning |
| Volume management complexity | Medium | Medium | Start simple, add cleanup cron |
| Port detection unreliable | High | Low | Fall back to manual "enter port" UI |
| Preview URL confusion | Medium | Low | Clear UI, copy button, docs |

---

## Out of Scope for Phase 3

- LSP / autocomplete / intellisense — Future
- Git integration — Future
- Collaborative editing — Future
- Multiple files open in split view — Future
- Image preview — Future
- Find in files — Stretch (if time)
- Quick file open (Cmd+P) — Stretch (if time)

---

## Task Breakdown

### Week 5

| Task | Estimate | Owner |
|------|----------|-------|
| Backend: SFTP client wrapper | 4 hours | — |
| Backend: File list endpoint | 3 hours | — |
| Backend: File read/write endpoints | 4 hours | — |
| Backend: File create/delete/rename endpoints | 4 hours | — |
| Backend: Fly Volume creation in project flow | 4 hours | — |
| Frontend: File tree component | 6 hours | — |
| Frontend: File tree context menu | 3 hours | — |
| Manual testing of file operations | 2 hours | — |

### Week 6

| Task | Estimate | Owner |
|------|----------|-------|
| Frontend: CodeMirror setup and configuration | 4 hours | — |
| Frontend: Editor component with save | 4 hours | — |
| Frontend: Editor tabs | 4 hours | — |
| Frontend: Workspace layout (resizable panels) | 4 hours | — |
| Frontend: Auto-save and dirty tracking | 3 hours | — |
| Backend/Infra: Port forwarding setup | 4 hours | — |
| Frontend: Preview button / URL display | 2 hours | — |
| Integration testing | 4 hours | — |
| Bug fixes and polish | 4 hours | — |

**Total estimated hours:** ~63 hours

---

## Definition of Done

Phase 3 is complete when:

1. ✅ User can see file tree in sidebar
2. ✅ User can click file to open in editor
3. ✅ Editor shows syntax highlighting for JS/TS/Python/Go/HTML/CSS
4. ✅ User can edit and save files (Cmd+S)
5. ✅ Auto-save works after 2 seconds idle
6. ✅ User can create new files and folders
7. ✅ User can delete files and folders
8. ✅ User can rename files
9. ✅ Files persist after stopping and restarting project
10. ✅ User can run dev server and access via preview URL
11. ✅ Preview URL is displayed in UI

---

## Design Decisions

1. **SFTP vs custom agent:** Use SFTP over existing SSH. It's standard, well-supported, and doesn't require additional code in the VM. Performance is adequate for typical file operations.

2. **File tree loading:** Lazy load directories on expand. Don't fetch entire tree upfront — projects can have thousands of files in `node_modules`. Cache aggressively, invalidate on mutations.

3. **Editor state:** Keep open files in memory with their content and dirty state. On tab close, warn if dirty. On save, sync to backend immediately.

4. **Auto-save:** 2-second debounce after last keystroke. Show subtle "Saving..." indicator. Don't auto-save if file has syntax errors (stretch — maybe skip for v1).

5. **Preview URL:** Start with Fly's built-in `.fly.dev` hostnames. Custom subdomains (`*.preview.aether.dev`) can come later when we need better branding/UX.

6. **Volume size:** 1GB default. Sufficient for most projects. Larger projects can wait for a future "upgrade storage" feature.

---

## API Reference (New Endpoints)

**List directory**
```
GET /projects/:id/files?path=/src

Response 200:
{
  "path": "/home/coder/project/src",
  "entries": [
    {"name": "index.js", "type": "file", "size": 1234, "modified": "..."},
    {"name": "components", "type": "directory", "modified": "..."}
  ]
}
```

**Read file**
```
GET /projects/:id/files?path=/src/index.js

Response 200:
{
  "path": "/home/coder/project/src/index.js",
  "content": "import React from 'react';...",
  "size": 1234,
  "modified": "..."
}

Response 400 (file too large):
{
  "error": "File too large",
  "size": 5242880,
  "max_size": 1048576
}
```

**Write file**
```
PUT /projects/:id/files?path=/src/index.js
{
  "content": "updated content..."
}

Response 200:
{
  "path": "/home/coder/project/src/index.js",
  "size": 2048,
  "modified": "..."
}
```

**Create directory**
```
POST /projects/:id/files/mkdir
{
  "path": "/src/components"
}

Response 201:
{
  "path": "/home/coder/project/src/components"
}
```

**Delete file/directory**
```
DELETE /projects/:id/files?path=/src/old.js

Response 204 (no content)
```

**Rename/move**
```
POST /projects/:id/files/rename
{
  "old_path": "/src/old.js",
  "new_path": "/src/new.js"
}

Response 200:
{
  "path": "/home/coder/project/src/new.js"
}
```
