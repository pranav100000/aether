import { useReducer, useCallback, useRef } from "react"
import type { ServerMessage, HistoryMessage, ToolData, ToolStatus } from "@/types/agent"
import type { ToolUIPart } from "ai"

// Map backend ToolStatus to frontend ToolUIPart state
function mapToolStatus(status: ToolStatus): ToolUIPart["state"] {
  switch (status) {
    case "pending":
      return "input-streaming"
    case "running":
      return "input-available"
    case "complete":
      return "output-available"
    case "error":
      return "output-error"
    case "awaiting_input":
      // Use "approval-requested" for human-in-the-loop tools awaiting user input
      return "approval-requested"
    default:
      return "input-available"
  }
}

// =============================================================================
// Message Types - Discriminated union for clarity
// =============================================================================

interface BaseMessage {
  id: string
  timestamp: Date
}

export interface UserMessage extends BaseMessage {
  role: "user"
  content: string
}

export interface TextMessage extends BaseMessage {
  role: "assistant"
  variant: "text"
  content: string
}

export interface ToolMessage extends BaseMessage {
  role: "assistant"
  variant: "tool"
  tool: {
    id: string
    name: string
    input: Record<string, unknown>
    status: ToolUIPart["state"]
    result?: string
    error?: string
  }
}

export interface ThinkingMessage extends BaseMessage {
  role: "assistant"
  variant: "thinking"
  content: string
  isStreaming: boolean
  duration?: number
}

export type ChatMessage = UserMessage | TextMessage | ToolMessage | ThinkingMessage

export type ChatStatus = "ready" | "submitted" | "streaming" | "error"

// =============================================================================
// Type Guards
// =============================================================================

function isTextMessage(msg: ChatMessage): msg is TextMessage {
  return msg.role === "assistant" && (msg as TextMessage).variant === "text"
}

function isToolMessage(msg: ChatMessage): msg is ToolMessage {
  return msg.role === "assistant" && (msg as ToolMessage).variant === "tool"
}

function isThinkingMessage(msg: ChatMessage): msg is ThinkingMessage {
  return msg.role === "assistant" && (msg as ThinkingMessage).variant === "thinking"
}

// =============================================================================
// Actions
// =============================================================================

type MessageAction =
  | { type: "ADD_USER_MESSAGE"; id: string; content: string }
  | { type: "APPEND_TEXT"; content: string }
  | { type: "ADD_TOOL"; id: string; tool: ToolData }
  | { type: "UPDATE_TOOL_RESULT"; toolId: string; result?: string; error?: string }
  | { type: "APPEND_THINKING"; content: string }
  | { type: "FINISH_THINKING"; duration: number }
  | { type: "RESTORE_HISTORY"; messages: ChatMessage[] }
  | { type: "CLEAR" }

// =============================================================================
// Reducer - Clean, predictable state transitions
// =============================================================================

function messagesReducer(state: ChatMessage[], action: MessageAction): ChatMessage[] {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return [
        ...state,
        {
          id: action.id,
          role: "user",
          content: action.content,
          timestamp: new Date(),
        },
      ]

    case "APPEND_TEXT": {
      const last = state.at(-1)

      // Append to existing text message
      if (last && isTextMessage(last)) {
        return [
          ...state.slice(0, -1),
          { ...last, content: last.content + action.content },
        ]
      }

      // Create new text message
      return [
        ...state,
        {
          id: `text-${Date.now()}`,
          role: "assistant",
          variant: "text",
          content: action.content,
          timestamp: new Date(),
        },
      ]
    }

    case "ADD_TOOL":
      return [
        ...state,
        {
          id: action.id,
          role: "assistant",
          variant: "tool",
          timestamp: new Date(),
          tool: {
            id: action.tool.id,
            name: action.tool.name,
            input: action.tool.input,
            status: mapToolStatus(action.tool.status),
          },
        },
      ]

    case "UPDATE_TOOL_RESULT":
      return state.map((msg) => {
        if (isToolMessage(msg) && msg.tool.id === action.toolId) {
          return {
            ...msg,
            tool: {
              ...msg.tool,
              status: action.error ? "output-error" : "output-available",
              result: action.result,
              error: action.error,
            },
          }
        }
        return msg
      })

    case "APPEND_THINKING": {
      const last = state.at(-1)

      // Append to existing streaming thinking
      if (last && isThinkingMessage(last) && last.isStreaming) {
        return [
          ...state.slice(0, -1),
          { ...last, content: last.content + action.content },
        ]
      }

      // Create new thinking message
      return [
        ...state,
        {
          id: `thinking-${Date.now()}`,
          role: "assistant",
          variant: "thinking",
          content: action.content,
          timestamp: new Date(),
          isStreaming: true,
        },
      ]
    }

    case "FINISH_THINKING": {
      const last = state.at(-1)
      if (last && isThinkingMessage(last)) {
        return [
          ...state.slice(0, -1),
          { ...last, isStreaming: false, duration: action.duration },
        ]
      }
      return state
    }

    case "RESTORE_HISTORY":
      return action.messages

    case "CLEAR":
      return []

    default:
      return state
  }
}

// =============================================================================
// History Conversion
// =============================================================================

function historyToChatMessage(histMsg: HistoryMessage): ChatMessage {
  // Tool message
  if (histMsg.tool) {
    return {
      id: histMsg.id,
      role: "assistant",
      variant: "tool",
      timestamp: new Date(histMsg.timestamp),
      tool: {
        id: histMsg.tool.id,
        name: histMsg.tool.name,
        input: histMsg.tool.input,
        status: histMsg.tool.result
          ? "output-available"
          : histMsg.tool.error
            ? "output-error"
            : "input-available",
        result: histMsg.tool.result,
        error: histMsg.tool.error,
      },
    }
  }

  // User message
  if (histMsg.role === "user") {
    return {
      id: histMsg.id,
      role: "user",
      content: histMsg.content,
      timestamp: new Date(histMsg.timestamp),
    }
  }

  // Assistant text message
  return {
    id: histMsg.id,
    role: "assistant",
    variant: "text",
    content: histMsg.content,
    timestamp: new Date(histMsg.timestamp),
  }
}

// =============================================================================
// Hook
// =============================================================================

export interface UseAgentMessagesReturn {
  messages: ChatMessage[]
  status: ChatStatus
  dispatch: React.Dispatch<MessageAction>
  setStatus: (status: ChatStatus) => void
  generateId: () => string
  handleServerMessage: (message: ServerMessage) => void
  addUserMessage: (content: string) => string
  clear: () => void
}

export function useAgentMessages(): UseAgentMessagesReturn {
  const [messages, dispatch] = useReducer(messagesReducer, [])
  const [status, setStatusState] = useReducer(
    (_: ChatStatus, newStatus: ChatStatus) => newStatus,
    "ready"
  )

  const messageIdRef = useRef(0)
  const thinkingStartRef = useRef<number | null>(null)

  const generateId = useCallback(() => {
    messageIdRef.current += 1
    return `msg-${messageIdRef.current}`
  }, [])

  const setStatus = useCallback((newStatus: ChatStatus) => {
    setStatusState(newStatus)
  }, [])

  const addUserMessage = useCallback(
    (content: string) => {
      const id = generateId()
      dispatch({ type: "ADD_USER_MESSAGE", id, content })
      setStatus("submitted")
      return id
    },
    [generateId, setStatus]
  )

  const handleServerMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "init":
          break

        case "history":
          if (message.history) {
            const restoredMessages = message.history.map(historyToChatMessage)
            dispatch({ type: "RESTORE_HISTORY", messages: restoredMessages })

            const maxId = restoredMessages.reduce((max, m) => {
              const num = parseInt(m.id.replace("msg-", ""), 10)
              return isNaN(num) ? max : Math.max(max, num)
            }, 0)
            messageIdRef.current = maxId
          }
          break

        case "thinking":
          if (message.content) {
            if (thinkingStartRef.current === null) {
              thinkingStartRef.current = Date.now()
            }
            dispatch({ type: "APPEND_THINKING", content: message.content })
          }
          break

        case "text":
          if (message.content) {
            setStatus("streaming")

            // Finalize thinking if active
            if (thinkingStartRef.current !== null) {
              const duration = Math.ceil((Date.now() - thinkingStartRef.current) / 1000)
              dispatch({ type: "FINISH_THINKING", duration })
              thinkingStartRef.current = null
            }

            dispatch({ type: "APPEND_TEXT", content: message.content })
          }
          break

        case "tool_use":
          if (message.tool) {
            dispatch({
              type: "ADD_TOOL",
              id: generateId(),
              tool: {
                id: message.tool.id,
                name: message.tool.name,
                input: message.tool.input,
                status: message.tool.status,
              },
            })
          }
          break

        case "tool_result":
          if (message.toolId) {
            dispatch({
              type: "UPDATE_TOOL_RESULT",
              toolId: message.toolId,
              result: message.result,
              error: message.error,
            })
          }
          break

        case "error":
          setStatus("error")
          break

        case "done":
          setStatus("ready")
          thinkingStartRef.current = null
          break
      }
    },
    [generateId, setStatus]
  )

  const clear = useCallback(() => {
    dispatch({ type: "CLEAR" })
    messageIdRef.current = 0
    thinkingStartRef.current = null
    setStatus("ready")
  }, [setStatus])

  return {
    messages,
    status,
    dispatch,
    setStatus,
    generateId,
    handleServerMessage,
    addUserMessage,
    clear,
  }
}
