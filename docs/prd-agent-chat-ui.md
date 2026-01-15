# PRD: AgentChat Premium UI Enhancement

## Executive Summary

Enhance the AgentChat component with premium features: @files autocomplete, voice input, file attachments, improved model selection, and a refined message protocol. This PRD covers changes across the frontend, agent interface, and individual agent implementations.

---

## 1. Frontend Changes

### 1.1 @files Autocomplete (Client-Side)

**Goal:** Allow users to type `@` to search and attach project files as context.

**Approach:** Use a shared file tree context that caches file paths as the user browses directories. The @files autocomplete searches this cache client-side - no backend endpoint needed.

#### Components to Create

| File                                                       | Purpose                                       |
| ---------------------------------------------------------- | --------------------------------------------- |
| `frontend/src/contexts/FileTreeContext.tsx`                | Global cache of all known file paths          |
| `frontend/src/components/ui/popover.tsx`                   | Radix popover wrapper for positioning         |
| `frontend/src/hooks/useFileAutocomplete.ts`                | State management for autocomplete             |
| `frontend/src/components/workspace/FileMentionPopover.tsx` | File picker dropdown using PromptInputCommand |
| `frontend/src/components/workspace/FilePill.tsx`           | Removable file attachment badge               |

#### FileTreeContext Design

```typescript
// frontend/src/contexts/FileTreeContext.tsx
interface FileTreeContextValue {
  // All known file paths (cached as user navigates)
  allFiles: string[];

  // Add files to cache when directory is expanded
  addFiles: (parentPath: string, entries: FileEntry[]) => void;

  // Search files by query (fuzzy match on path)
  searchFiles: (query: string, limit?: number) => string[];

  // Recursively load a directory (for initial @files search)
  preloadDirectory: (path: string, depth?: number) => Promise<void>;
}

// Usage in FileTreeItem - cache files when expanded
useEffect(() => {
  if (expanded && children.length > 0) {
    addFiles(path, children);
  }
}, [expanded, children]);
```

#### Search Algorithm

```typescript
function searchFiles(query: string, limit = 20): string[] {
  if (!query) return allFiles.slice(0, limit);

  const lowerQuery = query.toLowerCase();

  return allFiles
    .filter((path) => {
      const filename = path.split("/").pop()?.toLowerCase() ?? "";
      const pathLower = path.toLowerCase();
      // Match filename first, then full path
      return filename.includes(lowerQuery) || pathLower.includes(lowerQuery);
    })
    .sort((a, b) => {
      // Prioritize exact filename matches
      const aName = a.split("/").pop()?.toLowerCase() ?? "";
      const bName = b.split("/").pop()?.toLowerCase() ?? "";
      const aExact = aName === lowerQuery;
      const bExact = bName === lowerQuery;
      if (aExact !== bExact) return aExact ? -1 : 1;
      // Then by path length (shorter = more relevant)
      return a.length - b.length;
    })
    .slice(0, limit);
}
```

#### Initial Preload Strategy

When @files autocomplete opens:

1. Search the current cache immediately
2. If cache is small (< 50 files), trigger `preloadDirectory("/", 2)` to load 2 levels deep
3. Show loading indicator while preloading, but display results as they come in

#### Changes to AgentChat.tsx

```typescript
// New state
const [attachedFiles, setAttachedFiles] = useState<string[]>([])
const textareaRef = useRef<HTMLTextAreaElement>(null)

// Use file tree context
const { searchFiles, preloadDirectory } = useFileTreeContext()

// Detect @ trigger
const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
  setInput(e.target.value)
  const cursor = e.target.selectionStart
  if (e.target.value[cursor - 1] === '@') {
    openFileAutocomplete(getCaretPosition(textareaRef.current, cursor))
    preloadDirectory("/", 2) // Preload in background
  }
}

// Include files in message
wsRef.current.send(JSON.stringify({
  type: "prompt",
  prompt: userMessage,
  settings: { ... },
  context: {
    files: attachedFiles.map(path => ({ path, include: true }))
  }
}))
```

#### UI Layout

```tsx
<FileTreeProvider projectId={projectId}>
  <PromptInput onSubmit={handleSubmit}>
    <PromptInputHeader>
      {attachedFiles.map(file => (
        <FilePill key={file} path={file} onRemove={() => removeFile(file)} />
      ))}
    </PromptInputHeader>

    <PromptInputBody>
      <PromptInputTextarea ref={textareaRef} onChange={handleInputChange} ... />
    </PromptInputBody>

    <PromptInputFooter>...</PromptInputFooter>
  </PromptInput>

  <FileMentionPopover
    open={autocomplete.isOpen}
    position={autocomplete.position}
    query={autocomplete.query}
    files={searchFiles(autocomplete.query)}
    onSelect={handleFileSelect}
    onClose={autocomplete.close}
  />
</FileTreeProvider>
```

#### FileMentionPopover Component

```tsx
// frontend/src/components/workspace/FileMentionPopover.tsx
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  PromptInputCommand,
  PromptInputCommandInput,
  PromptInputCommandList,
  PromptInputCommandItem,
  PromptInputCommandEmpty,
} from "@/components/ai-elements/prompt-input";
import { FileIcon, FileCodeIcon, FileTextIcon } from "lucide-react";

interface FileMentionPopoverProps {
  open: boolean;
  position: { top: number; left: number } | null;
  query: string;
  files: string[];
  loading?: boolean;
  onSelect: (file: string) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
}

export function FileMentionPopover({
  open,
  position,
  query,
  files,
  loading,
  onSelect,
  onClose,
  onQueryChange,
}: FileMentionPopoverProps) {
  if (!open || !position) return null;

  return (
    <Popover open={open} onOpenChange={(o) => !o && onClose()}>
      <PopoverContent
        className="w-80 p-0"
        style={{ position: "absolute", top: position.top, left: position.left }}
        align="start"
      >
        <PromptInputCommand>
          <PromptInputCommandInput
            placeholder="Search files..."
            value={query}
            onValueChange={onQueryChange}
            autoFocus
          />
          <PromptInputCommandList>
            {loading && (
              <div className="py-2 px-3 text-xs text-muted-foreground">Loading files...</div>
            )}
            <PromptInputCommandEmpty>No files found</PromptInputCommandEmpty>
            {files.map((file) => (
              <PromptInputCommandItem key={file} value={file} onSelect={() => onSelect(file)}>
                <FileIcon className="size-4 mr-2 text-muted-foreground" />
                <span className="truncate">{file}</span>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandList>
        </PromptInputCommand>
      </PopoverContent>
    </Popover>
  );
}
```

#### FilePill Component

```tsx
// frontend/src/components/workspace/FilePill.tsx
import { XIcon, FileIcon } from "lucide-react";

interface FilePillProps {
  path: string;
  onRemove: () => void;
}

export function FilePill({ path, onRemove }: FilePillProps) {
  const filename = path.split("/").pop();

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs">
      <FileIcon className="size-3 text-muted-foreground" />
      <span className="truncate max-w-[150px]" title={path}>
        {filename}
      </span>
      <button onClick={onRemove} className="hover:text-destructive">
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
```

---

### 1.2 Voice Input

**Goal:** Add speech-to-text using existing PromptInputSpeechButton.

#### Changes to AgentChat.tsx

```typescript
import { PromptInputSpeechButton } from "@/components/ai-elements/prompt-input"

// In PromptInputTools
<PromptInputTools>
  <PromptInputSpeechButton />
  {/* existing buttons */}
</PromptInputTools>
```

The speech button automatically integrates with PromptInput context to append transcribed text.

---

### 1.3 File Attachments (Images, Documents)

**Goal:** Enable drag-drop and paste file uploads with previews.

#### Changes to AgentChat.tsx

```typescript
import {
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputAttachments,
  PromptInputAttachment,
} from "@/components/ai-elements/prompt-input"

<PromptInput
  onSubmit={handleSubmit}
  accept="image/*,application/pdf,text/*,.md,.json,.yaml,.yml"
  maxFiles={5}
  maxFileSize={10 * 1024 * 1024} // 10MB
  globalDrop
  onError={(err) => setError(err.message)}
>
  <PromptInputBody>
    <PromptInputAttachments>
      {(attachment) => (
        <PromptInputAttachment data={attachment} onRemove={() => removeAttachment(attachment)} />
      )}
    </PromptInputAttachments>
    <PromptInputTextarea ... />
  </PromptInputBody>

  <PromptInputFooter>
    <PromptInputTools>
      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger />
        <PromptInputActionMenuContent>
          <PromptInputActionAddAttachments />
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
      ...
    </PromptInputTools>
  </PromptInputFooter>
</PromptInput>
```

---

### 1.4 ModelSelector Dialog

**Goal:** Replace basic dropdown with searchable command dialog.

#### Changes to AgentChat.tsx

```typescript
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector"

const [modelDialogOpen, setModelDialogOpen] = useState(false)

// Keyboard shortcut
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setModelDialogOpen(true)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])

// Replace Settings dropdown model section with:
<ModelSelector open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
  <ModelSelectorTrigger asChild>
    <button className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800">
      <ModelSelectorLogo provider={getProviderFromModel(settings.model)} />
      <span>{getModelLabel(settings.model)}</span>
    </button>
  </ModelSelectorTrigger>
  <ModelSelectorContent>
    <ModelSelectorInput placeholder="Search models..." />
    <ModelSelectorList>
      {Object.entries(agentConfig).map(([agentKey, config]) => (
        <ModelSelectorGroup key={agentKey} heading={config.name}>
          {config.models.map(model => (
            <ModelSelectorItem
              key={model.value}
              value={model.value}
              onSelect={() => handleModelSelect(agentKey, model.value)}
            >
              <ModelSelectorLogo provider={getProviderFromModel(model.value)} />
              <ModelSelectorName>{model.label}</ModelSelectorName>
            </ModelSelectorItem>
          ))}
        </ModelSelectorGroup>
      ))}
    </ModelSelectorList>
  </ModelSelectorContent>
</ModelSelector>
```

#### Helper Functions

```typescript
function getProviderFromModel(model: string): string {
  if (model.includes("opus") || model.includes("sonnet") || model.includes("haiku"))
    return "anthropic";
  if (model.includes("gpt") || model.includes("codex")) return "openai";
  if (model.includes("openrouter:")) return "openrouter";
  return "opencode";
}
```

---

### 1.5 Additional UI Enhancements

#### Token/Cost Display (Context Component)

```typescript
import { Context, ContextTrigger, ContextContent, ... } from "@/components/ai-elements/context"

// After each message with usage data
{msg.usage && (
  <Context usedTokens={msg.usage.inputTokens + msg.usage.outputTokens} maxTokens={200000}>
    <ContextTrigger />
    <ContextContent>
      <ContextInputUsage tokens={msg.usage.inputTokens} />
      <ContextOutputUsage tokens={msg.usage.outputTokens} />
    </ContextContent>
  </Context>
)}
```

#### Message Actions (Copy, Regenerate)

```typescript
import { MessageActions, MessageAction } from "@/components/ai-elements/message"

<Message from="assistant">
  <MessageContent>...</MessageContent>
  <MessageActions>
    <MessageAction icon={CopyIcon} label="Copy" onClick={() => copyToClipboard(msg.content)} />
    <MessageAction icon={RefreshCwIcon} label="Regenerate" onClick={() => regenerate(msg.id)} />
  </MessageActions>
</Message>
```

#### Keyboard Shortcuts

| Shortcut    | Action                 |
| ----------- | ---------------------- |
| `Cmd+K`     | Open model selector    |
| `Escape`    | Close popovers/dialogs |
| `Cmd+Enter` | Send message           |
| `@`         | Open file autocomplete |

---

### 1.6 Dependencies to Add

```bash
pnpm add @radix-ui/react-popover textarea-caret
```

---

## 2. Agent Interface Changes

### 2.1 Enhanced Message Protocol

The current protocol needs extensions to support file context and attachments.

#### Client → Agent Messages

**Current:**

```typescript
interface ClientMessage {
  type: "prompt" | "settings" | "approve" | "reject" | "abort";
  prompt?: string;
  settings?: AgentSettings;
  toolId?: string;
}
```

**Enhanced:**

```typescript
interface ClientMessage {
  type: "prompt" | "settings" | "approve" | "reject" | "abort";
  prompt?: string;
  settings?: AgentSettings;
  toolId?: string;

  // NEW: File context
  context?: {
    files?: Array<{
      path: string; // Relative path from project root
      include: boolean; // Whether to read file content
      selection?: {
        // Optional: specific lines/range
        startLine: number;
        endLine: number;
      };
    }>;
    attachments?: Array<{
      filename: string;
      mediaType: string;
      data: string; // Base64 encoded content
    }>;
  };
}
```

#### Agent → Client Messages

**Enhanced (additions):**

```typescript
interface AgentMessage {
  // ... existing fields ...

  // NEW: Usage tracking per message
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    thinkingTokens?: number;
    cost?: number;
  };

  // NEW: File references in response
  fileReferences?: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
  }>;
}
```

---

### 2.2 AgentConfig Interface Updates

**File:** `agent-service/src/types.ts`

```typescript
interface AgentConfig {
  cwd: string;
  autoApprove: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  extendedThinking?: boolean;
  conversationHistory?: ConversationMessage[];

  // NEW: File context passed with prompt
  fileContext?: Array<{
    path: string;
    content?: string; // Pre-read content (if include: true)
    selection?: {
      startLine: number;
      endLine: number;
    };
  }>;

  // NEW: Binary attachments (images, PDFs)
  attachments?: Array<{
    filename: string;
    mediaType: string;
    data: string; // Base64
  }>;
}
```

---

### 2.3 CLI Changes

**File:** `agent-service/src/cli.ts`

Update `handleMessage()` to process context:

```typescript
async function handleMessage(line: string) {
  const msg: ClientMessage = JSON.parse(line);

  if (msg.type === "prompt") {
    // Process file context
    let fileContext: FileContext[] = [];
    if (msg.context?.files) {
      fileContext = await Promise.all(
        msg.context.files.map(async (f) => {
          if (f.include) {
            const fullPath = path.join(cwd, f.path);
            const content = await readFile(fullPath, "utf-8");
            return { path: f.path, content, selection: f.selection };
          }
          return { path: f.path };
        })
      );
    }

    // Pass to agent
    const config: AgentConfig = {
      ...currentSettings,
      cwd,
      fileContext,
      attachments: msg.context?.attachments,
    };

    await runQuery(msg.prompt, config);
  }
}
```

---

## 3. Individual Agent Changes

### 3.1 Claude Provider

**File:** `agent-service/src/agents/claude.ts`

#### File Context Integration

```typescript
async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
  // Build system message with file context
  let systemContext = ""
  if (config.fileContext?.length) {
    systemContext = "The user has provided the following files as context:\n\n"
    for (const file of config.fileContext) {
      if (file.content) {
        const content = file.selection
          ? extractLines(file.content, file.selection.startLine, file.selection.endLine)
          : file.content
        systemContext += `<file path="${file.path}">\n${content}\n</file>\n\n`
      } else {
        systemContext += `<file path="${file.path}" />\n`
      }
    }
  }

  // Include attachments as user message parts
  const userContent: MessagePart[] = [{ type: "text", text: prompt }]
  if (config.attachments?.length) {
    for (const att of config.attachments) {
      if (att.mediaType.startsWith("image/")) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: att.mediaType, data: att.data }
        })
      }
    }
  }

  // Create agent with context
  const agent = new Agent({
    model: this.getModel(config.model),
    systemPrompt: systemContext || undefined,
    // ... rest of config
  })
}
```

#### Enhanced Usage Tracking

```typescript
// After turn completion
yield {
  type: "done",
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens,
    thinkingTokens: response.usage.thinking_tokens,
    cost: calculateCost(response.usage, config.model)
  }
}
```

---

### 3.2 Codex Provider

**File:** `agent-service/src/agents/codex.ts`

#### File Context Integration

```typescript
async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
  // Codex uses file references differently - add to prompt
  let enhancedPrompt = prompt
  if (config.fileContext?.length) {
    const fileList = config.fileContext.map(f => f.path).join(", ")
    enhancedPrompt = `Context files: ${fileList}\n\n${prompt}`

    // If content provided, prepend to prompt
    for (const file of config.fileContext) {
      if (file.content) {
        enhancedPrompt = `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n${enhancedPrompt}`
      }
    }
  }

  const thread = await this.client.threads.create({
    workingDirectory: config.cwd,
    prompt: enhancedPrompt,
    // ... rest
  })
}
```

#### Image Attachment Support

```typescript
// Codex may support images via the thread API
if (config.attachments?.length) {
  for (const att of config.attachments) {
    if (att.mediaType.startsWith("image/")) {
      await this.client.threads.addImage(thread.id, {
        data: att.data,
        mediaType: att.mediaType,
      });
    }
  }
}
```

---

### 3.3 Codebuff Provider

**File:** `agent-service/src/agents/codebuff.ts`

#### File Context Integration

```typescript
async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
  // Codebuff SDK context attachment
  const contextFiles = config.fileContext?.map(f => ({
    path: f.path,
    content: f.content
  })) ?? []

  const run = await this.client.chat.completions.create({
    messages: [
      { role: "user", content: prompt }
    ],
    context: contextFiles,  // SDK-specific context passing
    previousRun: this.previousRun,
    // ...
  })
}
```

---

### 3.4 OpenCode Provider

**File:** `agent-service/src/agents/opencode.ts`

#### File Context Integration

```typescript
async *query(prompt: string, config: AgentConfig): AsyncIterable<AgentMessage> {
  // OpenCode uses session context
  if (config.fileContext?.length) {
    await this.client.sessions.addContext(this.sessionId, {
      files: config.fileContext.map(f => ({
        path: path.join(config.cwd, f.path),
        range: f.selection ? { start: f.selection.startLine, end: f.selection.endLine } : undefined
      }))
    })
  }

  // Handle attachments via message parts
  const parts: MessagePart[] = [{ type: "text", text: prompt }]
  for (const att of config.attachments ?? []) {
    parts.push({ type: "file", data: att.data, mimeType: att.mediaType, name: att.filename })
  }

  await this.client.sessions.sendMessage(this.sessionId, { parts })
}
```

---

## 4. File Structure Summary

### New Files

| Path                                                       | Purpose                 |
| ---------------------------------------------------------- | ----------------------- |
| `frontend/src/contexts/FileTreeContext.tsx`                | Global file path cache  |
| `frontend/src/components/ui/popover.tsx`                   | Radix popover component |
| `frontend/src/hooks/useFileAutocomplete.ts`                | Autocomplete hook       |
| `frontend/src/components/workspace/FileMentionPopover.tsx` | File picker UI          |
| `frontend/src/components/workspace/FilePill.tsx`           | File badge component    |

### Modified Files

| Path                                                 | Changes                        |
| ---------------------------------------------------- | ------------------------------ |
| `frontend/src/components/workspace/AgentChat.tsx`    | All UI enhancements            |
| `frontend/src/components/workspace/FileTree.tsx`     | Integrate with FileTreeContext |
| `frontend/src/components/workspace/FileTreeItem.tsx` | Add files to cache on expand   |
| `agent-service/src/types.ts`                         | Enhanced interfaces            |
| `agent-service/src/cli.ts`                           | Process file context           |
| `agent-service/src/agents/claude.ts`                 | File context + attachments     |
| `agent-service/src/agents/codex.ts`                  | File context + attachments     |
| `agent-service/src/agents/codebuff.ts`               | File context                   |
| `agent-service/src/agents/opencode.ts`               | File context + attachments     |

---

## 5. Implementation Order

### Phase 1: Frontend UI (No Backend/Agent Changes)

1. Add voice input (PromptInputSpeechButton)
2. Add file attachments (PromptInputAttachments)
3. Replace model dropdown with ModelSelector dialog
4. Add keyboard shortcuts (Cmd+K for model selector)

### Phase 2: @files Autocomplete (Frontend Only)

1. Create FileTreeContext with file cache
2. Modify FileTree/FileTreeItem to populate cache
3. Create Popover component
4. Create useFileAutocomplete hook
5. Create FileMentionPopover component
6. Create FilePill component
7. Integrate into AgentChat

### Phase 3: Agent Interface Updates

1. Update types.ts with new interfaces
2. Update cli.ts to read file content and pass to agents
3. Update each agent provider to handle file context

### Phase 4: Image Attachments for Agents

1. Update message protocol to include attachments
2. Update Claude provider to pass images
3. Test with other providers as supported

### Phase 5: Polish

1. Add usage/cost display (Context component)
2. Add message actions (copy, regenerate)
3. Error handling and loading states
4. Performance optimization (debouncing, memoization)

---

## 6. Verification Checklist

### Frontend

- [ ] Type `@` shows file search dropdown
- [ ] Dropdown shows files from cached directories
- [ ] Expanding directories in FileTree adds files to cache
- [ ] Select file adds pill to input header
- [ ] Pills can be removed with X button
- [ ] Voice button appears and transcribes speech
- [ ] Drag-drop image shows thumbnail
- [ ] Paste image from clipboard works
- [ ] Model selector dialog opens with Cmd+K
- [ ] Model search filters results
- [ ] Selected model persists across messages

### Agent Interface

- [ ] File paths sent in message context.files
- [ ] cli.ts reads file content when include: true
- [ ] fileContext passed to agent providers

### Agents

- [ ] Claude receives file content in system prompt
- [ ] Claude receives image attachments
- [ ] Codex receives file content in prompt
- [ ] Codebuff receives context files
- [ ] OpenCode receives session context
- [ ] Usage stats display after each response
