"use client"

import { Badge } from "@/components/ui/badge"
import {
  FilePath,
  Terminal,
  CodeDisplay,
  CodeDiff,
  DirectoryTree,
  TodoList,
  SearchResults,
  ThinkingDisplay,
  QuestionsDisplay,
} from "../shared"
import { FileTreeView } from "../shared/FileTreeView"
import type {
  ReadFilesParams,
  WriteFileParams,
  StrReplaceParams,
  ProposeStrReplaceParams,
  ProposeWriteFileParams,
  RunTerminalCommandParams,
  CodeSearchParams,
  GlobParams,
  ListDirectoryParams,
  FindFilesParams,
  WebSearchParams,
  WriteTodosParams,
  ThinkDeeplyParams,
  AskUserParams,
  SpawnAgentsParams,
  SpawnAgentInlineParams,
  ReadSubtreeParams,
  AddSubgoalParams,
  UpdateSubgoalParams,
  SubgoalStatus,
} from "./types"
import {
  FileTextIcon,
  FileIcon,
  FileEditIcon,
  TerminalIcon,
  SearchIcon,
  FolderSearchIcon,
  FolderIcon,
  GlobeIcon,
  ListTodoIcon,
  BrainIcon,
  MessageCircleQuestionIcon,
  BotIcon,
  TreeDeciduousIcon,
  AlertCircleIcon,
  BookOpenIcon,
  MessageSquareIcon,
  CheckCircleIcon,
  TargetIcon,
  RefreshCwIcon,
} from "lucide-react"
import { CodeBlock } from "@/components/ai-elements/code-block"

export interface ToolRendererProps {
  name: string
  input: Record<string, unknown>
  result?: string
  error?: string
}

// read_files renderer
function ReadFilesRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as ReadFilesParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileTextIcon className="size-4 text-blue-400" />
        <span className="text-sm text-zinc-300">Reading {params.paths.length} file(s)</span>
      </div>
      <div className="space-y-1">
        {params.paths.map((path, i) => (
          <FilePath key={i} path={path} />
        ))}
      </div>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <CodeDisplay code={result} path={params.paths[0]} />
      )}
    </div>
  )
}

// write_file renderer
function WriteFileRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as WriteFileParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileIcon className="size-4 text-green-400" />
        <FilePath path={params.path} showIcon={false} />
        <Badge variant="secondary" className="text-xs">write</Badge>
      </div>
      {params.instructions && (
        <p className="text-xs text-zinc-500">{params.instructions}</p>
      )}
      <CodeDisplay code={params.content} path={params.path} />
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="text-xs text-green-400">File written successfully</div>
      )}
    </div>
  )
}

// str_replace renderer
function StrReplaceRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as StrReplaceParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileEditIcon className="size-4 text-yellow-400" />
        <FilePath path={params.path} showIcon={false} />
        <Badge variant="secondary" className="text-xs">
          {params.replacements.length} replacement(s)
        </Badge>
      </div>
      {params.replacements.map((rep, i) => (
        <CodeDiff key={i} path={params.path} oldCode={rep.old} newCode={rep.new} />
      ))}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="text-xs text-green-400">Replacements applied successfully</div>
      )}
    </div>
  )
}

// propose_str_replace renderer (same as str_replace but labeled as proposal)
function ProposeStrReplaceRenderer({ input, error }: ToolRendererProps) {
  const params = input as unknown as ProposeStrReplaceParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileEditIcon className="size-4 text-amber-400" />
        <FilePath path={params.path} showIcon={false} />
        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
          proposed
        </Badge>
      </div>
      {params.replacements.map((rep, i) => (
        <CodeDiff key={i} path={params.path} oldCode={rep.old} newCode={rep.new} />
      ))}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

// propose_write_file renderer
function ProposeWriteFileRenderer({ input, error }: ToolRendererProps) {
  const params = input as unknown as ProposeWriteFileParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileIcon className="size-4 text-amber-400" />
        <FilePath path={params.path} showIcon={false} />
        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
          proposed
        </Badge>
      </div>
      {params.instructions && (
        <p className="text-xs text-zinc-500">{params.instructions}</p>
      )}
      <CodeDisplay code={params.content} path={params.path} />
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

// run_terminal_command renderer
function RunTerminalCommandRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as RunTerminalCommandParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TerminalIcon className="size-4 text-purple-400" />
        <span className="text-sm text-zinc-300">Terminal Command</span>
        {params.timeout_seconds && params.timeout_seconds > 0 && (
          <span className="text-xs text-zinc-500">timeout: {params.timeout_seconds}s</span>
        )}
      </div>
      <Terminal
        command={params.command}
        output={result}
        error={error}
        cwd={params.cwd}
        isBackground={params.process_type === "BACKGROUND"}
      />
    </div>
  )
}

// code_search renderer
function CodeSearchRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as CodeSearchParams

  // Parse result into matches (format: file:line:content)
  const matches = result
    ? result.split("\n").filter(Boolean).map((line) => {
        const match = line.match(/^([^:]+):(\d+):(.*)$/)
        if (match) {
          return { file: match[1], line: parseInt(match[2], 10), content: match[3] }
        }
        return { file: "", line: 0, content: line }
      })
    : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SearchIcon className="size-4 text-cyan-400" />
        <code className="text-sm bg-zinc-800 px-2 py-0.5 rounded text-cyan-300">
          {params.pattern}
        </code>
        {params.cwd && (
          <span className="text-xs text-zinc-500">in {params.cwd}</span>
        )}
        {params.flags && (
          <span className="text-xs text-zinc-600">{params.flags}</span>
        )}
      </div>
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : matches.length > 0 ? (
        <SearchResults pattern={params.pattern} matches={matches} />
      ) : result !== undefined ? (
        <div className="text-xs text-zinc-500">No matches found</div>
      ) : null}
    </div>
  )
}

// glob renderer
function GlobRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as GlobParams
  const files = result ? result.split("\n").filter(Boolean) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FolderSearchIcon className="size-4 text-orange-400" />
        <code className="text-sm bg-zinc-800 px-2 py-0.5 rounded text-orange-300">
          {params.pattern}
        </code>
        {params.cwd && (
          <span className="text-xs text-zinc-500">in {params.cwd}</span>
        )}
      </div>
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : files.length > 0 ? (
        <FileTreeView files={files} />
      ) : result !== undefined ? (
        <div className="text-xs text-zinc-500">No files found</div>
      ) : null}
    </div>
  )
}

// list_directory renderer
function ListDirectoryRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as ListDirectoryParams

  // Parse result - expecting format like "file1\nfile2\ndir1/\ndir2/"
  const entries = result
    ? result.split("\n").filter(Boolean).map((name) => ({
        name: name.replace(/\/$/, ""),
        type: name.endsWith("/") ? "directory" as const : "file" as const,
      }))
    : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FolderIcon className="size-4 text-blue-400" />
        <span className="text-sm text-zinc-300">List Directory</span>
      </div>
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : entries.length > 0 ? (
        <DirectoryTree path={params.path} entries={entries} />
      ) : result !== undefined ? (
        <div className="text-xs text-zinc-500">Empty directory</div>
      ) : null}
    </div>
  )
}

// find_files renderer
function FindFilesRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as FindFilesParams
  const files = result ? result.split("\n").filter(Boolean) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SearchIcon className="size-4 text-indigo-400" />
        <span className="text-sm text-zinc-300">Find Files</span>
      </div>
      <p className="text-xs text-zinc-500 italic">&ldquo;{params.prompt}&rdquo;</p>
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : files.length > 0 ? (
        <FileTreeView files={files} />
      ) : result !== undefined ? (
        <div className="text-xs text-zinc-500">No files found</div>
      ) : null}
    </div>
  )
}

// read_subtree renderer
function ReadSubtreeRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as ReadSubtreeParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TreeDeciduousIcon className="size-4 text-green-400" />
        <span className="text-sm text-zinc-300">Read Subtree</span>
        {params.maxTokens && (
          <span className="text-xs text-zinc-500">max {params.maxTokens} tokens</span>
        )}
      </div>
      {params.paths && params.paths.length > 0 && (
        <div className="space-y-1">
          {params.paths.map((path, i) => (
            <FilePath key={i} path={path} />
          ))}
        </div>
      )}
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : result ? (
        <CodeDisplay code={result} language="markdown" maxHeight="400px" />
      ) : null}
    </div>
  )
}

// web_search renderer
function WebSearchRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as WebSearchParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GlobeIcon className="size-4 text-blue-400" />
        <span className="text-sm text-zinc-300">Web Search</span>
        {params.depth === "deep" && (
          <Badge variant="secondary" className="text-xs">deep</Badge>
        )}
      </div>
      <p className="text-sm text-zinc-200">&ldquo;{params.query}&rdquo;</p>
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : result ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 max-h-60 overflow-auto">
          <p className="text-sm text-zinc-400 whitespace-pre-wrap">{result}</p>
        </div>
      ) : null}
    </div>
  )
}

// write_todos renderer
function WriteTodosRenderer({ input, error }: ToolRendererProps) {
  const params = input as unknown as WriteTodosParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListTodoIcon className="size-4 text-emerald-400" />
        <span className="text-sm text-zinc-300">Task List</span>
      </div>
      <TodoList todos={params.todos} />
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

// think_deeply renderer
function ThinkDeeplyRenderer({ input }: ToolRendererProps) {
  const params = input as unknown as ThinkDeeplyParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainIcon className="size-4 text-purple-400" />
        <span className="text-sm text-zinc-300">Thinking</span>
      </div>
      <ThinkingDisplay thought={params.thought} />
    </div>
  )
}

// ask_user renderer
function AskUserRenderer({ input }: ToolRendererProps) {
  const params = input as unknown as AskUserParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircleQuestionIcon className="size-4 text-amber-400" />
        <span className="text-sm text-zinc-300">Questions</span>
      </div>
      <QuestionsDisplay questions={params.questions} />
    </div>
  )
}

// spawn_agents renderer
function SpawnAgentsRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as SpawnAgentsParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 text-violet-400" />
        <span className="text-sm text-zinc-300">
          Spawning {params.agents.length} agent(s)
        </span>
      </div>
      <div className="space-y-2">
        {params.agents.map((agent, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {agent.agent_type}
              </Badge>
            </div>
            {agent.prompt && (
              <p className="text-xs text-zinc-400 line-clamp-2">{agent.prompt}</p>
            )}
          </div>
        ))}
      </div>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 max-h-40 overflow-auto">
          <p className="text-sm text-zinc-400 whitespace-pre-wrap">{result}</p>
        </div>
      )}
    </div>
  )
}

// spawn_agent_inline renderer
function SpawnAgentInlineRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as SpawnAgentInlineParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 text-violet-400" />
        <span className="text-sm text-zinc-300">Spawning Agent</span>
        <Badge variant="secondary" className="text-xs">
          {params.agent_type}
        </Badge>
      </div>
      {params.prompt && (
        <p className="text-xs text-zinc-400 line-clamp-2">{params.prompt}</p>
      )}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="text-xs text-green-400">Agent spawned successfully</div>
      )}
    </div>
  )
}

// set_messages renderer
function SetMessagesRenderer({ result, error }: ToolRendererProps) {
  const message = parseResultMessage(result)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquareIcon className="size-4 text-blue-400" />
        <span className="text-sm text-zinc-300">Messages Updated</span>
      </div>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="text-xs text-zinc-400">{message}</div>
      )}
    </div>
  )
}

// end_turn renderer
function EndTurnRenderer({ result, error }: ToolRendererProps) {
  const message = parseResultMessage(result)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircleIcon className="size-4 text-green-400" />
        <span className="text-sm text-zinc-300">Turn Ended</span>
      </div>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="text-xs text-zinc-400">{message}</div>
      )}
    </div>
  )
}

// Status color mapping for subgoals
const subgoalStatusColors: Record<SubgoalStatus, string> = {
  NOT_STARTED: "text-zinc-400",
  IN_PROGRESS: "text-blue-400",
  COMPLETE: "text-green-400",
  ABORTED: "text-red-400",
}

const subgoalStatusLabels: Record<SubgoalStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  ABORTED: "Aborted",
}

// add_subgoal renderer
function AddSubgoalRenderer({ input, result, error }: ToolRendererProps) {
  const params = input as unknown as AddSubgoalParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TargetIcon className="size-4 text-cyan-400" />
        <span className="text-sm text-zinc-300">Add Subgoal</span>
        {params.status && (
          <Badge variant="secondary" className={`text-xs ${subgoalStatusColors[params.status] || ""}`}>
            {subgoalStatusLabels[params.status] || params.status}
          </Badge>
        )}
      </div>
      <p className="text-sm text-zinc-200">{params.objective}</p>
      {params.plan && (
        <p className="text-xs text-zinc-500">{params.plan}</p>
      )}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="text-xs text-green-400">Subgoal added</div>
      )}
    </div>
  )
}

// update_subgoal renderer
function UpdateSubgoalRenderer({ input, error }: ToolRendererProps) {
  const params = input as unknown as UpdateSubgoalParams

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <RefreshCwIcon className="size-4 text-cyan-400" />
        <span className="text-sm text-zinc-300">Update Subgoal</span>
        <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
          {params.id}
        </code>
        {params.status && (
          <Badge variant="secondary" className={`text-xs ${subgoalStatusColors[params.status] || ""}`}>
            {subgoalStatusLabels[params.status] || params.status}
          </Badge>
        )}
      </div>
      {params.plan && (
        <p className="text-xs text-zinc-400">{params.plan}</p>
      )}
      {params.log && (
        <p className="text-xs text-zinc-500 italic">{params.log}</p>
      )}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}

// Helper to parse JSON result messages
function parseResultMessage(result?: string): string | null {
  if (!result) return null
  try {
    // Try to parse as JSON array (e.g., [{"type":"json","value":{"message":"..."}}])
    const parsed = JSON.parse(result)
    if (Array.isArray(parsed) && parsed[0]?.value?.message) {
      return parsed[0].value.message
    }
    if (parsed?.value?.message) {
      return parsed.value.message
    }
    if (parsed?.message) {
      return parsed.message
    }
  } catch {
    // Not JSON, return as-is if it's a simple string
    if (result && !result.startsWith("{") && !result.startsWith("[")) {
      return result
    }
  }
  return null
}

// Default renderer for unhandled tools
function DefaultRenderer({ name, input, result, error }: ToolRendererProps) {
  const hasInput = input && Object.keys(input).length > 0
  const message = parseResultMessage(result)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 text-zinc-400" />
        <span className="text-sm text-zinc-300">{name}</span>
      </div>
      {hasInput && (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden">
          <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
        </div>
      )}
      {error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : message ? (
        <div className="text-xs text-zinc-400">{message}</div>
      ) : result ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 max-h-40 overflow-auto">
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap">{result}</pre>
        </div>
      ) : null}
    </div>
  )
}

// Tool icon mapping
export const toolIcons: Record<string, typeof FileIcon> = {
  read_files: FileTextIcon,
  write_file: FileIcon,
  str_replace: FileEditIcon,
  propose_str_replace: FileEditIcon,
  propose_write_file: FileIcon,
  run_terminal_command: TerminalIcon,
  code_search: SearchIcon,
  glob: FolderSearchIcon,
  list_directory: FolderIcon,
  find_files: SearchIcon,
  read_subtree: TreeDeciduousIcon,
  web_search: GlobeIcon,
  read_docs: BookOpenIcon,
  write_todos: ListTodoIcon,
  think_deeply: BrainIcon,
  ask_user: MessageCircleQuestionIcon,
  spawn_agents: BotIcon,
  spawn_agent_inline: BotIcon,
  set_messages: MessageSquareIcon,
  end_turn: CheckCircleIcon,
  add_subgoal: TargetIcon,
  update_subgoal: RefreshCwIcon,
}

// Tool color mapping
export const toolColors: Record<string, string> = {
  read_files: "text-blue-400",
  write_file: "text-green-400",
  str_replace: "text-yellow-400",
  propose_str_replace: "text-amber-400",
  propose_write_file: "text-amber-400",
  run_terminal_command: "text-purple-400",
  code_search: "text-cyan-400",
  glob: "text-orange-400",
  list_directory: "text-blue-400",
  find_files: "text-indigo-400",
  read_subtree: "text-green-400",
  web_search: "text-blue-400",
  read_docs: "text-emerald-400",
  write_todos: "text-emerald-400",
  think_deeply: "text-purple-400",
  ask_user: "text-amber-400",
  spawn_agents: "text-violet-400",
  spawn_agent_inline: "text-violet-400",
  set_messages: "text-blue-400",
  end_turn: "text-green-400",
  add_subgoal: "text-cyan-400",
  update_subgoal: "text-cyan-400",
}

// Main renderer component
export function CodebuffToolRenderer(props: ToolRendererProps) {
  const { name } = props
  const toolName = name.toLowerCase()

  switch (toolName) {
    case "read_files":
      return <ReadFilesRenderer {...props} />
    case "write_file":
      return <WriteFileRenderer {...props} />
    case "str_replace":
      return <StrReplaceRenderer {...props} />
    case "propose_str_replace":
      return <ProposeStrReplaceRenderer {...props} />
    case "propose_write_file":
      return <ProposeWriteFileRenderer {...props} />
    case "run_terminal_command":
      return <RunTerminalCommandRenderer {...props} />
    case "code_search":
      return <CodeSearchRenderer {...props} />
    case "glob":
      return <GlobRenderer {...props} />
    case "list_directory":
      return <ListDirectoryRenderer {...props} />
    case "find_files":
      return <FindFilesRenderer {...props} />
    case "read_subtree":
      return <ReadSubtreeRenderer {...props} />
    case "web_search":
      return <WebSearchRenderer {...props} />
    case "write_todos":
      return <WriteTodosRenderer {...props} />
    case "think_deeply":
      return <ThinkDeeplyRenderer {...props} />
    case "ask_user":
      return <AskUserRenderer {...props} />
    case "spawn_agents":
      return <SpawnAgentsRenderer {...props} />
    case "spawn_agent_inline":
      return <SpawnAgentInlineRenderer {...props} />
    case "set_messages":
      return <SetMessagesRenderer {...props} />
    case "end_turn":
      return <EndTurnRenderer {...props} />
    case "add_subgoal":
      return <AddSubgoalRenderer {...props} />
    case "update_subgoal":
      return <UpdateSubgoalRenderer {...props} />
    default:
      return <DefaultRenderer {...props} />
  }
}

// Get icon for a tool
export function getCodebuffToolIcon(name: string) {
  return toolIcons[name.toLowerCase()] || AlertCircleIcon
}

// Get color for a tool
export function getCodebuffToolColor(name: string): string {
  return toolColors[name.toLowerCase()] || "text-zinc-400"
}
