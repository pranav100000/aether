import { useReducer, useCallback, useRef } from "react"
import type { ServerMessage, HistoryMessage, ToolData } from "@/types/agent"
import type { ToolUIPart } from "ai"

// Chat message as displayed in UI
export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
  tool?: {
    id: string
    name: string
    input: Record<string, unknown>
    status: ToolUIPart["state"]
    result?: string
    error?: string
  }
  thinking?: {
    content: string
    isStreaming: boolean
    duration?: number
  }
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error"

// Actions for the reducer
type MessageAction =
  | { type: "ADD_USER_MESSAGE"; id: string; content: string }
  | { type: "START_ASSISTANT_MESSAGE"; id: string }
  | { type: "APPEND_TEXT"; content: string }
  | { type: "START_THINKING"; id: string }
  | { type: "APPEND_THINKING"; content: string }
  | { type: "FINISH_THINKING"; duration: number }
  | { type: "ADD_TOOL_USE"; id: string; tool: ToolData }
  | { type: "UPDATE_TOOL_RESULT"; toolId: string; result?: string; error?: string }
  | { type: "RESTORE_HISTORY"; messages: ChatMessage[] }
  | { type: "CLEAR" }

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

    case "START_ASSISTANT_MESSAGE":
      return [
        ...state,
        {
          id: action.id,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        },
      ]

    case "APPEND_TEXT": {
      const last = state[state.length - 1]
      if (!last || last.role !== "assistant") {
        // No assistant message to append to - this shouldn't happen
        console.warn("[useAgentMessages] APPEND_TEXT with no assistant message")
        return state
      }

      // If we were thinking, finalize thinking first and set content
      if (last.thinking?.isStreaming) {
        return [
          ...state.slice(0, -1),
          {
            ...last,
            thinking: { ...last.thinking, isStreaming: false },
            content: action.content,
          },
        ]
      }

      // Append to existing content
      return [
        ...state.slice(0, -1),
        { ...last, content: last.content + action.content },
      ]
    }

    case "START_THINKING":
      return [
        ...state,
        {
          id: action.id,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          thinking: {
            content: "",
            isStreaming: true,
          },
        },
      ]

    case "APPEND_THINKING": {
      const last = state[state.length - 1]
      if (!last?.thinking?.isStreaming) {
        // Start a new thinking block if needed
        return [
          ...state,
          {
            id: `thinking-${Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: new Date(),
            thinking: {
              content: action.content,
              isStreaming: true,
            },
          },
        ]
      }

      return [
        ...state.slice(0, -1),
        {
          ...last,
          thinking: {
            ...last.thinking,
            content: last.thinking.content + action.content,
          },
        },
      ]
    }

    case "FINISH_THINKING": {
      const last = state[state.length - 1]
      if (!last?.thinking) return state

      return [
        ...state.slice(0, -1),
        {
          ...last,
          thinking: {
            ...last.thinking,
            isStreaming: false,
            duration: action.duration,
          },
        },
      ]
    }

    case "ADD_TOOL_USE":
      return [
        ...state,
        {
          id: action.id,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          tool: {
            id: action.tool.id,
            name: action.tool.name,
            input: action.tool.input,
            status: "input-available",
          },
        },
      ]

    case "UPDATE_TOOL_RESULT":
      return state.map((msg) => {
        if (msg.tool?.id === action.toolId) {
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

    case "RESTORE_HISTORY":
      return action.messages

    case "CLEAR":
      return []

    default:
      return state
  }
}

// Convert history message from server to chat message
function historyToChatMessage(histMsg: HistoryMessage): ChatMessage {
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
      status: histMsg.tool.result
        ? "output-available"
        : histMsg.tool.error
          ? "output-error"
          : "input-available",
      result: histMsg.tool.result,
      error: histMsg.tool.error,
    }
  }

  return chatMsg
}

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

  const addUserMessage = useCallback((content: string) => {
    const id = generateId()
    dispatch({ type: "ADD_USER_MESSAGE", id, content })
    setStatus("submitted")
    return id
  }, [generateId, setStatus])

  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "init":
        // Session initialized
        break

      case "history":
        if (message.history) {
          const restoredMessages = message.history.map(historyToChatMessage)
          dispatch({ type: "RESTORE_HISTORY", messages: restoredMessages })

          // Update message ID counter to avoid collisions
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
            dispatch({ type: "START_THINKING", id: generateId() })
          }
          dispatch({ type: "APPEND_THINKING", content: message.content })
        }
        break

      case "text":
        if (message.content) {
          setStatus("streaming")

          // Finalize thinking if we were thinking
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
            type: "ADD_TOOL_USE",
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
  }, [generateId, setStatus])

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
