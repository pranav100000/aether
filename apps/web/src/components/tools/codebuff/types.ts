// Codebuff tool types - based on the tool definitions from the agent

export type ToolName =
  | "add_message"
  | "add_subgoal"
  | "ask_user"
  | "code_search"
  | "end_turn"
  | "find_files"
  | "glob"
  | "list_directory"
  | "lookup_agent_info"
  | "propose_str_replace"
  | "propose_write_file"
  | "read_docs"
  | "read_files"
  | "read_subtree"
  | "run_file_change_hooks"
  | "run_terminal_command"
  | "set_messages"
  | "set_output"
  | "spawn_agent_inline"
  | "spawn_agents"
  | "str_replace"
  | "suggest_followups"
  | "task_completed"
  | "think_deeply"
  | "update_subgoal"
  | "web_search"
  | "write_file"
  | "write_todos"

export interface ReadFilesParams {
  paths: string[]
}

export interface WriteFileParams {
  path: string
  instructions: string
  content: string
}

export interface StrReplaceParams {
  path: string
  replacements: {
    old: string
    new: string
    allowMultiple?: boolean
  }[]
}

export interface ProposeStrReplaceParams {
  path: string
  replacements: {
    old: string
    new: string
    allowMultiple?: boolean
  }[]
}

export interface ProposeWriteFileParams {
  path: string
  instructions: string
  content: string
}

export interface RunTerminalCommandParams {
  command: string
  process_type?: "SYNC" | "BACKGROUND"
  cwd?: string
  timeout_seconds?: number
}

export interface CodeSearchParams {
  pattern: string
  flags?: string
  cwd?: string
  maxResults?: number
}

export interface GlobParams {
  pattern: string
  cwd?: string
}

export interface ListDirectoryParams {
  path: string
}

export interface FindFilesParams {
  prompt: string
}

export interface ReadSubtreeParams {
  paths?: string[]
  maxTokens?: number
}

export interface WebSearchParams {
  query: string
  depth?: "standard" | "deep"
}

export interface ReadDocsParams {
  libraryTitle: string
  topic: string
  max_tokens?: number
}

export interface WriteTodosParams {
  todos: {
    task: string
    completed: boolean
  }[]
}

export interface ThinkDeeplyParams {
  thought: string
}

export interface AskUserParams {
  questions: {
    question: string
    header?: string
    options: {
      label: string
      description?: string
    }[]
    multiSelect?: boolean
    validation?: {
      maxLength?: number
      minLength?: number
      pattern?: string
      patternError?: string
    }
  }[]
}

export interface SpawnAgentsParams {
  agents: {
    agent_type: string
    prompt?: string
    params?: Record<string, unknown>
  }[]
}

export interface AddMessageParams {
  role: "user" | "assistant"
  content: string
}

export interface SuggestFollowupsParams {
  followups: {
    prompt: string
    label?: string
  }[]
}

export interface LookupAgentInfoParams {
  agentId: string
}

export interface RunFileChangeHooksParams {
  files: string[]
}

export interface SetMessagesParams {
  messages: unknown
}

// Spawn agent inline
export interface SpawnAgentInlineParams {
  agent_type: string
  prompt?: string
  params?: Record<string, unknown>
}

// Subgoal status enum (matches Codebuff SDK)
export type SubgoalStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "ABORTED"

// Subgoal params
export interface AddSubgoalParams {
  id: string
  objective: string
  status: SubgoalStatus
  plan?: string
  log?: string
}

export interface UpdateSubgoalParams {
  id: string
  status?: SubgoalStatus
  plan?: string
  log?: string
}

// Empty params
export interface EndTurnParams {}
export interface TaskCompletedParams {}
export interface SetOutputParams {}

// Map of tool names to their parameter types
export interface ToolParamsMap {
  add_message: AddMessageParams
  add_subgoal: AddSubgoalParams
  ask_user: AskUserParams
  code_search: CodeSearchParams
  end_turn: EndTurnParams
  find_files: FindFilesParams
  glob: GlobParams
  list_directory: ListDirectoryParams
  lookup_agent_info: LookupAgentInfoParams
  propose_str_replace: ProposeStrReplaceParams
  propose_write_file: ProposeWriteFileParams
  read_docs: ReadDocsParams
  read_files: ReadFilesParams
  read_subtree: ReadSubtreeParams
  run_file_change_hooks: RunFileChangeHooksParams
  run_terminal_command: RunTerminalCommandParams
  set_messages: SetMessagesParams
  set_output: SetOutputParams
  spawn_agent_inline: SpawnAgentInlineParams
  spawn_agents: SpawnAgentsParams
  str_replace: StrReplaceParams
  suggest_followups: SuggestFollowupsParams
  task_completed: TaskCompletedParams
  think_deeply: ThinkDeeplyParams
  update_subgoal: UpdateSubgoalParams
  web_search: WebSearchParams
  write_file: WriteFileParams
  write_todos: WriteTodosParams
}

export type GetToolParams<T extends ToolName> = ToolParamsMap[T]
