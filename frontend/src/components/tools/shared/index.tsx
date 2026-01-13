"use client"

import { cn } from "@/lib/utils"
import {
  FileIcon,
  FolderIcon,
  CheckSquareIcon,
  SquareIcon,
  ChevronRightIcon,
} from "lucide-react"
import type { BundledLanguage } from "shiki"
import { CodeBlock } from "@/components/ai-elements/code-block"

// Language detection from file path
export function getLanguageFromPath(path: string): BundledLanguage {
  const ext = path.split(".").pop()?.toLowerCase()
  const langMap: Record<string, BundledLanguage> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    java: "java",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    dockerfile: "dockerfile",
    toml: "toml",
    xml: "xml",
    vue: "vue",
    svelte: "svelte",
  }
  return (langMap[ext || ""] || "markdown") as BundledLanguage
}

// File path display with icon
export interface FilePathProps {
  path: string
  className?: string
  showIcon?: boolean
}

export function FilePath({ path, className, showIcon = true }: FilePathProps) {
  return (
    <div className={cn("flex items-center gap-1.5 font-mono text-sm", className)}>
      {showIcon && <FileIcon className="size-3.5 text-zinc-500 flex-shrink-0" />}
      <span className="text-zinc-300 truncate">{path}</span>
    </div>
  )
}

// Terminal output display
export interface TerminalProps {
  command: string
  output?: string
  error?: string
  cwd?: string
  isBackground?: boolean
  className?: string
}

export function Terminal({ command, output, error, cwd, isBackground, className }: TerminalProps) {
  return (
    <div className={cn("rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden", className)}>
      {/* Terminal header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 bg-zinc-900/50">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-red-500/80" />
          <div className="size-2.5 rounded-full bg-yellow-500/80" />
          <div className="size-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="text-xs text-zinc-500 font-medium">
          {cwd ? `terminal — ${cwd}` : "terminal"}
        </span>
        {isBackground && (
          <span className="ml-auto text-xs text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
            background
          </span>
        )}
      </div>

      {/* Command */}
      <div className="p-3 border-b border-zinc-800/50">
        <div className="flex items-start gap-2 font-mono text-sm">
          <span className="text-green-400 select-none">$</span>
          <code className="text-zinc-200 whitespace-pre-wrap break-all">{command}</code>
        </div>
      </div>

      {/* Output */}
      {(output || error) && (
        <div className="max-h-64 overflow-auto">
          <pre
            className={cn(
              "p-3 font-mono text-xs whitespace-pre-wrap break-all",
              error ? "text-red-400" : "text-zinc-400"
            )}
          >
            {error || output}
          </pre>
        </div>
      )}
    </div>
  )
}

// Code display with syntax highlighting
export interface CodeDisplayProps {
  code: string
  language?: BundledLanguage
  path?: string
  maxHeight?: string
  className?: string
}

export function CodeDisplay({ code, language, path, maxHeight = "320px", className }: CodeDisplayProps) {
  const lang: BundledLanguage = language || (path ? getLanguageFromPath(path) : "markdown")

  return (
    <div className={cn("rounded-lg overflow-hidden", className)} style={{ maxHeight }}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
}

// Diff view for code changes
export interface CodeDiffProps {
  path: string
  oldCode: string
  newCode: string
  className?: string
}

export function CodeDiff({ path, oldCode, newCode, className }: CodeDiffProps) {
  const lang = getLanguageFromPath(path)

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-red-400 flex items-center gap-1">
            <span className="text-red-500">−</span> Old
          </div>
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 overflow-hidden max-h-48 overflow-auto">
            <CodeBlock code={oldCode} language={lang} />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-green-400 flex items-center gap-1">
            <span className="text-green-500">+</span> New
          </div>
          <div className="rounded-lg bg-green-500/5 border border-green-500/20 overflow-hidden max-h-48 overflow-auto">
            <CodeBlock code={newCode} language={lang} />
          </div>
        </div>
      </div>
    </div>
  )
}

// Directory tree display
export interface DirectoryEntry {
  name: string
  type: "file" | "directory"
}

export interface DirectoryTreeProps {
  path: string
  entries: DirectoryEntry[]
  className?: string
}

export function DirectoryTree({ path, entries, className }: DirectoryTreeProps) {
  const dirs = entries.filter((e) => e.type === "directory").sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((e) => e.type === "file").sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
        <span className="font-mono text-xs text-zinc-500">{path}</span>
      </div>
      <div className="max-h-60 overflow-auto divide-y divide-zinc-800/50">
        {dirs.map((dir) => (
          <div
            key={dir.name}
            className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800/30 transition-colors"
          >
            <FolderIcon className="size-3.5 text-blue-400 flex-shrink-0" />
            <span className="font-mono text-zinc-300">{dir.name}/</span>
          </div>
        ))}
        {files.map((file) => (
          <div
            key={file.name}
            className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800/30 transition-colors"
          >
            <FileIcon className="size-3.5 text-zinc-500 flex-shrink-0" />
            <span className="font-mono text-zinc-400">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Todo list display
export interface TodoItem {
  task: string
  completed: boolean
}

export interface TodoListProps {
  todos: TodoItem[]
  className?: string
}

export function TodoList({ todos, className }: TodoListProps) {
  const completed = todos.filter((t) => t.completed).length

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">Tasks</span>
        <span className="text-xs text-zinc-500">
          {completed}/{todos.length} completed
        </span>
      </div>
      <div className="divide-y divide-zinc-800/50">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-2.5">
            {todo.completed ? (
              <CheckSquareIcon className="size-4 text-green-400 mt-0.5 flex-shrink-0" />
            ) : (
              <SquareIcon className="size-4 text-zinc-500 mt-0.5 flex-shrink-0" />
            )}
            <span
              className={cn(
                "text-sm",
                todo.completed ? "text-zinc-500 line-through" : "text-zinc-300"
              )}
            >
              {todo.task}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Search results display
export interface SearchMatch {
  file: string
  line: number
  content: string
}

export interface SearchResultsProps {
  pattern: string
  matches: SearchMatch[]
  maxVisible?: number
  className?: string
}

export function SearchResults({ pattern, matches, maxVisible = 30, className }: SearchResultsProps) {
  const visibleMatches = matches.slice(0, maxVisible)
  const remaining = matches.length - maxVisible

  // Group by file
  const groupedByFile = visibleMatches.reduce(
    (acc, match) => {
      if (!acc[match.file]) acc[match.file] = []
      acc[match.file].push(match)
      return acc
    },
    {} as Record<string, SearchMatch[]>
  )

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
        <span className="font-mono text-xs text-cyan-400">{pattern}</span>
        <span className="text-xs text-zinc-500 ml-2">
          {matches.length} match{matches.length !== 1 ? "es" : ""}
        </span>
      </div>
      <div className="max-h-80 overflow-auto">
        {Object.entries(groupedByFile).map(([file, fileMatches]) => (
          <div key={file} className="border-b border-zinc-800/50 last:border-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/30">
              <FileIcon className="size-3 text-zinc-500" />
              <span className="font-mono text-xs text-zinc-400">{file}</span>
            </div>
            {fileMatches.map((match, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-3 py-1 hover:bg-zinc-800/20 font-mono text-xs"
              >
                <span className="text-zinc-600 w-8 text-right flex-shrink-0">{match.line}</span>
                <span className="text-zinc-400 whitespace-pre-wrap break-all">{match.content}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-800 bg-zinc-900/80">
          +{remaining} more matches
        </div>
      )}
    </div>
  )
}

// Thinking/reasoning display
export interface ThinkingDisplayProps {
  thought: string
  className?: string
}

export function ThinkingDisplay({ thought, className }: ThinkingDisplayProps) {
  return (
    <div className={cn("rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-purple-500/20 bg-purple-500/10">
        <span className="text-xs font-medium text-purple-400">Thinking</span>
      </div>
      <div className="p-3 max-h-60 overflow-auto">
        <p className="text-sm text-zinc-400 whitespace-pre-wrap">{thought}</p>
      </div>
    </div>
  )
}

// Question/Ask user display
export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect?: boolean
}

export interface QuestionsDisplayProps {
  questions: Question[]
  className?: string
}

export function QuestionsDisplay({ questions, className }: QuestionsDisplayProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {questions.map((q, i) => (
        <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <div className="px-3 py-2 border-b border-amber-500/20 bg-amber-500/10 flex items-center gap-2">
            {q.header && (
              <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                {q.header}
              </span>
            )}
            <span className="text-sm font-medium text-zinc-200">{q.question}</span>
          </div>
          <div className="p-2 space-y-1">
            {q.options.map((opt, j) => (
              <div
                key={j}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-amber-500/10 transition-colors"
              >
                <ChevronRightIcon className="size-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-sm text-zinc-300">{opt.label}</span>
                  {opt.description && (
                    <p className="text-xs text-zinc-500 mt-0.5">{opt.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
