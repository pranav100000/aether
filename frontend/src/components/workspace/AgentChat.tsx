import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react"
import { supabase } from "@/lib/supabase"
import { api } from "@/lib/api"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputButton,
  PromptInputSpeechButton,
} from "@/components/ai-elements/prompt-input"
import { Loader } from "@/components/ai-elements/loader"
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { cn } from "@/lib/utils"
import { RefreshCwIcon, TerminalIcon, SettingsIcon, BrainIcon, ShieldCheckIcon, FileEditIcon, SparklesIcon, ZapIcon, CodeIcon } from "lucide-react"
import type { ToolUIPart } from "ai"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFileTreeContext } from "@/contexts/FileTreeContext"
import { useFileAutocomplete } from "@/hooks/useFileAutocomplete"
import { FileMentionPopover } from "./FileMentionPopover"
import { FilePill } from "./FilePill"
import getCaretCoordinates from "textarea-caret"

type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"
type AgentType = "claude" | "codex" | "codebuff"

interface ModelOption {
  value: string
  label: string
}

interface AgentConfigItem {
  name: string
  icon: typeof TerminalIcon
  color: string
  models: ModelOption[]
  defaultModel: string
}

const agentConfig: Record<AgentType, AgentConfigItem> = {
  claude: {
    name: "Claude",
    icon: SparklesIcon,
    color: "text-orange-400",
    models: [
      { value: "sonnet", label: "Sonnet (Fast)" },
      { value: "opus", label: "Opus (Powerful)" },
      { value: "haiku", label: "Haiku (Quick)" },
    ],
    defaultModel: "sonnet",
  },
  codex: {
    name: "Codex",
    icon: ZapIcon,
    color: "text-green-400",
    models: [
      { value: "gpt-5.2-codex", label: "GPT-5.2 Codex (Best)" },
      { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
      { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini (Fast)" },
    ],
    defaultModel: "gpt-5.2-codex",
  },
  codebuff: {
    name: "Codebuff",
    icon: BrainIcon,
    color: "text-purple-400",
    models: [
      { value: "base", label: "Base Agent" },
    ],
    defaultModel: "base",
  },
  // opencode: {
  //   name: "OpenCode",
  //   icon: CodeIcon,
  //   color: "text-blue-400",
  //   models: [
  //     { value: "openrouter:anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (OpenRouter)" },
  //     { value: "openrouter:anthropic/claude-opus-4", label: "Claude Opus 4 (OpenRouter)" },
  //     { value: "openrouter:openai/gpt-5.2", label: "GPT-5.2 (OpenRouter)" },
  //     { value: "openrouter:google/gemini-3-pro", label: "Gemini 3 Pro (OpenRouter)" },
  //     { value: "openrouter:deepseek/deepseek-r1", label: "DeepSeek R1 (OpenRouter)" },
  //   ],
  //   defaultModel: "openrouter:anthropic/claude-sonnet-4",
  // },
}

interface AgentSettings {
  model: string
  permissionMode: PermissionMode
  extendedThinking: boolean
}

interface AgentChatProps {
  projectId: string
  defaultAgent?: AgentType
}

interface HistoryMessage {
  id: string
  timestamp: number
  role: "user" | "assistant" | "system"
  content: string
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: string
    result?: string
    error?: string
  }
}

interface AgentMessage {
  type: "init" | "history" | "text" | "tool_use" | "tool_result" | "error" | "done" | "thinking"
  agent?: string
  sessionId?: string
  history?: HistoryMessage[]
  content?: string
  streaming?: boolean
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: string
  }
  toolId?: string
  result?: string
  error?: string
}

interface ToolData {
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolUIPart["state"]
  result?: string
  error?: string
}

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
  tool?: ToolData
  thinking?: {
    content: string
    isStreaming: boolean
    duration?: number
  }
}

type ChatStatus = "submitted" | "streaming" | "ready" | "error"

export function AgentChat({ projectId, defaultAgent = "claude" }: AgentChatProps) {
  const [agent, setAgent] = useState<AgentType>(defaultAgent)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AgentSettings>(() => ({
    model: agentConfig[defaultAgent].defaultModel,
    permissionMode: "bypassPermissions",
    extendedThinking: true,
  }))
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const messageIdRef = useRef(0)
  const thinkingStartRef = useRef<number | null>(null)
  const connectionIdRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // File autocomplete
  const { searchFiles, preloadDirectory, isPreloading } = useFileTreeContext()
  const autocomplete = useFileAutocomplete()

  const currentAgentConfig = agentConfig[agent]
  const AgentIcon = currentAgentConfig.icon

  const generateId = useCallback(() => {
    messageIdRef.current += 1
    return `msg-${messageIdRef.current}`
  }, [])

  const connect = useCallback(async () => {
    const thisConnectionId = ++connectionIdRef.current

    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (connectionIdRef.current !== thisConnectionId) return

      if (!session?.access_token) {
        setError("Not authenticated")
        return
      }

      const wsUrl = api.getAgentUrl(projectId, agent)
      console.log("[AgentChat] Connecting to:", wsUrl)
      const ws = new WebSocket(wsUrl, ["bearer", session.access_token])

      if (connectionIdRef.current !== thisConnectionId) {
        ws.close()
        return
      }

      ws.onopen = () => {
        console.log("[AgentChat] WebSocket opened")
        if (connectionIdRef.current !== thisConnectionId) return
        setIsConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        if (connectionIdRef.current !== thisConnectionId) return
        try {
          const msg: AgentMessage = JSON.parse(event.data)

          if (msg.type === "init") {
            // Agent initialized successfully
          } else if (msg.type === "history" && msg.history) {
            // Restore messages from history
            const restoredMessages: ChatMessage[] = msg.history.map((histMsg) => {
              const chatMsg: ChatMessage = {
                id: histMsg.id,
                role: histMsg.role,
                content: histMsg.content,
                timestamp: new Date(histMsg.timestamp),
              }
              if (histMsg.tool) {
                chatMsg.tool = {
                  id: histMsg.tool.id,
                  name: histMsg.tool.name,
                  input: histMsg.tool.input,
                  status: histMsg.tool.result ? "output-available" : histMsg.tool.error ? "output-error" : "input-available",
                  result: histMsg.tool.result,
                  error: histMsg.tool.error,
                }
              }
              return chatMsg
            })
            setMessages(restoredMessages)
            // Update message ID counter to avoid collisions
            const maxId = restoredMessages.reduce((max, m) => {
              const num = parseInt(m.id.replace("msg-", ""), 10)
              return isNaN(num) ? max : Math.max(max, num)
            }, 0)
            messageIdRef.current = maxId
          } else if (msg.type === "thinking" && msg.content) {
            thinkingStartRef.current = thinkingStartRef.current ?? Date.now()
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.thinking?.isStreaming) {
                return [...prev.slice(0, -1), {
                  ...last,
                  thinking: {
                    ...last.thinking,
                    content: last.thinking.content + msg.content
                  }
                }]
              }
              return [...prev, {
                id: generateId(),
                role: "assistant",
                content: "",
                timestamp: new Date(),
                thinking: {
                  content: msg.content ?? "",
                  isStreaming: true
                }
              }]
            })
          } else if (msg.type === "text" && msg.content) {
            const content = msg.content
            setStatus("streaming")
            setMessages(prev => {
              const last = prev[prev.length - 1]
              // Finalize thinking if we were in thinking mode
              if (last?.thinking?.isStreaming) {
                const duration = thinkingStartRef.current
                  ? Math.ceil((Date.now() - thinkingStartRef.current) / 1000)
                  : undefined
                thinkingStartRef.current = null
                return [...prev.slice(0, -1), {
                  ...last,
                  thinking: { ...last.thinking, isStreaming: false, duration },
                  content
                }]
              }
              // Stream to existing assistant message
              if (last?.role === "assistant" && !last.tool && msg.streaming) {
                return [...prev.slice(0, -1), {
                  ...last,
                  content: last.content + content
                }]
              }
              return [...prev, {
                id: generateId(),
                role: "assistant",
                content,
                timestamp: new Date()
              }]
            })
          } else if (msg.type === "tool_use" && msg.tool) {
            setMessages(prev => [...prev, {
              id: generateId(),
              role: "assistant",
              content: "",
              timestamp: new Date(),
              tool: {
                id: msg.tool!.id,
                name: msg.tool!.name,
                input: msg.tool!.input,
                status: "input-available",
              }
            }])
          } else if (msg.type === "tool_result" && msg.toolId) {
            setMessages(prev => prev.map(m => {
              const tool = m.tool
              if (tool && tool.id === msg.toolId) {
                return {
                  ...m,
                  tool: {
                    id: tool.id,
                    name: tool.name,
                    input: tool.input,
                    status: msg.error ? "output-error" : "output-available",
                    result: msg.result,
                    error: msg.error
                  }
                }
              }
              return m
            }))
          } else if (msg.type === "error" && msg.error) {
            setError(msg.error)
            setStatus("error")
          } else if (msg.type === "done") {
            setStatus("ready")
          }
        } catch {
          console.error("Failed to parse message:", event.data)
        }
      }

      ws.onerror = (e) => {
        console.log("[AgentChat] WebSocket error:", e)
        if (connectionIdRef.current !== thisConnectionId) return
        setError("Connection error")
        setIsConnected(false)
        setStatus("error")
      }

      ws.onclose = (e) => {
        console.log("[AgentChat] WebSocket closed:", e.code, e.reason)
        if (connectionIdRef.current !== thisConnectionId) return
        setIsConnected(false)
        setStatus("ready")
      }

      wsRef.current = ws
    } catch (err) {
      if (connectionIdRef.current !== thisConnectionId) return
      setError(err instanceof Error ? err.message : "Failed to connect")
      setStatus("error")
    }
  }, [projectId, agent, generateId])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }

    const userMessage = text.trim()
    setInput("")
    setStatus("submitted")
    setError(null)

    setMessages(prev => [...prev, {
      id: generateId(),
      role: "user",
      content: userMessage,
      timestamp: new Date()
    }])

    wsRef.current.send(JSON.stringify({
      type: "prompt",
      prompt: userMessage,
      settings: {
        model: settings.model,
        permissionMode: settings.permissionMode,
        extendedThinking: settings.extendedThinking,
      }
    }))
  }, [generateId, settings])

  const handleSubmit = useCallback(({ text }: { text: string }) => {
    sendMessage(text)
  }, [sendMessage])

  const handleAgentChange = useCallback((newAgent: AgentType) => {
    if (newAgent === agent) return

    // Close existing connection
    wsRef.current?.close()
    setIsConnected(false)

    // Clear messages (each agent has its own session)
    setMessages([])
    messageIdRef.current = 0
    setError(null)
    setStatus("ready")

    // Reset model to new agent's default
    setSettings(s => ({ ...s, model: agentConfig[newAgent].defaultModel }))

    // Switch agent
    setAgent(newAgent)
  }, [agent])

  // @files autocomplete handlers
  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)

    const cursor = e.target.selectionStart ?? 0
    const charBefore = value[cursor - 1]

    // Detect @ trigger
    if (charBefore === "@" && textareaRef.current && containerRef.current) {
      const coords = getCaretCoordinates(textareaRef.current, cursor)
      const textareaRect = textareaRef.current.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()
      // Calculate position relative to the container (which has position: relative)
      autocomplete.open({
        top: textareaRect.top + coords.top - textareaRef.current.scrollTop - containerRect.top,
        left: textareaRect.left + coords.left - containerRect.left,
      })
      preloadDirectory("/", 2)
    }
  }, [autocomplete, preloadDirectory])

  const handleFileSelect = useCallback((file: string) => {
    setAttachedFiles(prev => {
      if (prev.includes(file)) return prev
      return [...prev, file]
    })
    // Remove the @ from input
    setInput(prev => prev.replace(/@[^@]*$/, ""))
    autocomplete.close()
  }, [autocomplete])

  const handleRemoveFile = useCallback((file: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== file))
  }, [])

  const searchResults = searchFiles(autocomplete.query, 15)

  const showEmptyState = messages.length === 0

  return (
    <div ref={containerRef} className="relative flex size-full flex-col divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <Select value={agent} onValueChange={(v) => handleAgentChange(v as AgentType)}>
            <SelectTrigger className="h-8 w-[130px] border-zinc-700 bg-zinc-900 text-xs">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <AgentIcon className={cn("size-4", currentAgentConfig.color)} />
                  <span>{currentAgentConfig.name}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(agentConfig) as AgentType[]).map((agentKey) => {
                const config = agentConfig[agentKey]
                const Icon = config.icon
                return (
                  <SelectItem key={agentKey} value={agentKey}>
                    <div className="flex items-center gap-2">
                      <Icon className={cn("size-4", config.color)} />
                      <span>{config.name}</span>
                    </div>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <span className={cn(
            "size-2 rounded-full",
            isConnected ? "bg-green-500" : "bg-red-500"
          )} />
          <Select value={settings.model} onValueChange={(v) => setSettings(s => ({ ...s, model: v }))}>
            <SelectTrigger className="h-8 w-[140px] border-zinc-700 bg-zinc-900 text-xs">
              <SelectValue>
                {currentAgentConfig.models.find(m => m.value === settings.model)?.label ?? settings.model}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {currentAgentConfig.models.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && (
            <button
              onClick={connect}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCwIcon className="size-3" />
              Reconnect
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                <SettingsIcon className="size-3" />
                Settings
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              <div className="px-2 pb-2">
                <Select value={settings.model} onValueChange={(v) => setSettings(s => ({ ...s, model: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentAgentConfig.models.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Permission Mode</DropdownMenuLabel>
              <div className="px-2 pb-2">
                <Select value={settings.permissionMode} onValueChange={(v) => setSettings(s => ({ ...s, permissionMode: v as PermissionMode }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bypassPermissions">
                      <div className="flex items-center gap-2">
                        <ShieldCheckIcon className="size-3" />
                        Auto-approve all
                      </div>
                    </SelectItem>
                    <SelectItem value="acceptEdits">
                      <div className="flex items-center gap-2">
                        <FileEditIcon className="size-3" />
                        Auto-approve edits
                      </div>
                    </SelectItem>
                    <SelectItem value="plan">
                      <div className="flex items-center gap-2">
                        <BrainIcon className="size-3" />
                        Plan mode
                      </div>
                    </SelectItem>
                    <SelectItem value="default">Ask for everything</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-2 py-2">
                <span className="text-xs text-zinc-400">Extended thinking</span>
                <button
                  onClick={() => setSettings(s => ({ ...s, extendedThinking: !s.extendedThinking }))}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    settings.extendedThinking ? "bg-blue-600" : "bg-zinc-700"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform",
                      settings.extendedThinking && "translate-x-4"
                    )}
                  />
                </button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <Conversation className="flex-1">
        <ConversationContent className="gap-4 p-4">
          {showEmptyState ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-zinc-800 p-4">
                <AgentIcon className={cn("size-8", currentAgentConfig.color)} />
              </div>
              <div>
                <h3 className="text-lg font-medium text-zinc-200">Chat with {currentAgentConfig.name}</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Ask questions about your code or give instructions
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <Message key={msg.id} from={msg.role === "user" ? "user" : "assistant"}>
                {msg.thinking && (
                  <Reasoning
                    isStreaming={msg.thinking.isStreaming}
                    duration={msg.thinking.duration}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{msg.thinking.content}</ReasoningContent>
                  </Reasoning>
                )}
                <MessageContent>
                  {msg.tool ? (
                    <Tool defaultOpen>
                      <ToolHeader
                        title={msg.tool.name}
                        type="tool-invocation"
                        state={msg.tool.status}
                      />
                      <ToolContent>
                        <ToolInput input={msg.tool.input} />
                        <ToolOutput
                          output={msg.tool.result}
                          errorText={msg.tool.error}
                        />
                      </ToolContent>
                    </Tool>
                  ) : msg.role === "system" ? (
                    <div className="text-xs text-zinc-500 italic">{msg.content}</div>
                  ) : msg.content ? (
                    <MessageResponse>{msg.content}</MessageResponse>
                  ) : null}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 text-zinc-400">
                  <Loader size={16} />
                  <span className="text-sm">Thinking...</span>
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Error */}
      {error && (
        <div className="shrink-0 bg-red-900/50 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Input Section */}
      <div className="grid shrink-0 gap-4 pt-4">
        <div className="w-full px-4 pb-4">
          {/* Attached Files */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((file) => (
                <FilePill key={file} path={file} onRemove={() => handleRemoveFile(file)} />
              ))}
            </div>
          )}
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                placeholder={isConnected ? "Ask anything about your code... (@ to mention files)" : "Connecting..."}
                disabled={!isConnected || status === "streaming" || status === "submitted"}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputSpeechButton textareaRef={textareaRef} />
                <PromptInputButton variant="ghost" disabled>
                  <AgentIcon className={cn("size-4", currentAgentConfig.color)} />
                  <span>{currentAgentConfig.name}</span>
                </PromptInputButton>
              </PromptInputTools>
              <PromptInputSubmit
                disabled={!isConnected || !input.trim() || status === "streaming" || status === "submitted"}
                status={status === "ready" ? undefined : status}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {/* File Mention Popover */}
      <FileMentionPopover
        open={autocomplete.isOpen}
        position={autocomplete.position}
        query={autocomplete.query}
        files={searchResults}
        loading={isPreloading}
        selectedIndex={autocomplete.selectedIndex}
        onSelect={handleFileSelect}
        onClose={autocomplete.close}
        onQueryChange={autocomplete.setQuery}
      />
    </div>
  )
}
