import { useState, useEffect, useRef, useCallback } from "react"
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
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { cn } from "@/lib/utils"
import { RefreshCwIcon, TerminalIcon } from "lucide-react"
import type { ToolUIPart } from "ai"

interface AgentChatProps {
  projectId: string
  agent?: "claude" | "codex" | "opencode"
}

interface AgentMessage {
  type: "init" | "text" | "tool_use" | "tool_result" | "error" | "done" | "thinking"
  agent?: string
  sessionId?: string
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

const suggestions = [
  "Explain the codebase structure",
  "Find and fix bugs in this file",
  "Write tests for the main functions",
  "Refactor for better performance",
]

export function AgentChat({ projectId, agent = "claude" }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const messageIdRef = useRef(0)
  const thinkingStartRef = useRef<number | null>(null)

  const generateId = useCallback(() => {
    messageIdRef.current += 1
    return `msg-${messageIdRef.current}`
  }, [])

  const connect = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError("Not authenticated")
        return
      }

      const wsUrl = api.getAgentUrl(projectId, agent)
      const ws = new WebSocket(wsUrl, ["bearer", session.access_token])

      ws.onopen = () => {
        setIsConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const msg: AgentMessage = JSON.parse(event.data)

          if (msg.type === "init") {
            // Silent init, no system message
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
              if (m.tool?.id === msg.toolId) {
                return {
                  ...m,
                  tool: {
                    ...m.tool,
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

      ws.onerror = () => {
        setError("Connection error")
        setIsConnected(false)
        setStatus("error")
      }

      ws.onclose = () => {
        setIsConnected(false)
        setStatus("ready")
      }

      wsRef.current = ws
    } catch (err) {
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
      prompt: userMessage
    }))
  }, [generateId])

  const handleSubmit = useCallback(({ text }: { text: string }) => {
    sendMessage(text)
  }, [sendMessage])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    sendMessage(suggestion)
  }, [sendMessage])

  const showEmptyState = messages.length === 0

  return (
    <div className="relative flex size-full flex-col divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200 capitalize">{agent}</span>
          <span className={cn(
            "size-2 rounded-full",
            isConnected ? "bg-green-500" : "bg-red-500"
          )} />
        </div>
        {!isConnected && (
          <button
            onClick={connect}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCwIcon className="size-3" />
            Reconnect
          </button>
        )}
      </div>

      {/* Messages */}
      <Conversation className="flex-1">
        <ConversationContent className="gap-4 p-4">
          {showEmptyState ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-zinc-800 p-4">
                <TerminalIcon className="size-8 text-zinc-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-zinc-200">Chat with {agent}</h3>
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
        {showEmptyState && (
          <Suggestions className="px-4">
            {suggestions.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        )}
        <div className="w-full px-4 pb-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isConnected ? "Ask anything about your code..." : "Connecting..."}
                disabled={!isConnected || status === "streaming" || status === "submitted"}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputButton variant="ghost" disabled>
                  <TerminalIcon className="size-4" />
                  <span>{agent}</span>
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
    </div>
  )
}
