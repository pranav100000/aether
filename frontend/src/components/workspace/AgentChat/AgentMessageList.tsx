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
import type { ChatMessage, ChatStatus } from "@/hooks/useAgentMessages"
import type { LucideIcon } from "lucide-react"

export interface AgentMessageListProps {
  messages: ChatMessage[]
  status: ChatStatus
  agentIcon: LucideIcon
  agentName: string
  agentColor: string
}

export function AgentMessageList({
  messages,
  status,
  agentIcon: AgentIcon,
  agentName,
  agentColor,
}: AgentMessageListProps) {
  const showEmptyState = messages.length === 0

  return (
    <Conversation className="flex-1">
      <ConversationContent className="gap-4 p-4">
        {showEmptyState ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-full bg-zinc-800 p-4">
              <AgentIcon className={cn("size-8", agentColor)} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-zinc-200">Chat with {agentName}</h3>
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
  )
}
