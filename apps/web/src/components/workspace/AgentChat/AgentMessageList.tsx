import { prettifyText } from "@/lib/text-formatting";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Loader } from "@/components/ai-elements/loader";
import { Tool, ToolHeader, ToolContent } from "@/components/ai-elements/tool";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { ToolRenderer, getToolIcon, getToolColor } from "@/components/tools";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatStatus,
  TextMessage,
  ToolMessage,
  ThinkingMessage,
} from "@/hooks/useAgentMessages";
import type { AgentType, ToolResponsePayload } from "@/types/agent";
import type { LucideIcon } from "lucide-react";

export interface AgentMessageListProps {
  messages: ChatMessage[];
  status: ChatStatus;
  agent: AgentType;
  agentIcon: LucideIcon;
  agentName: string;
  agentColor: string;
  /** Callback for human-in-the-loop tool responses */
  onToolResponse?: (response: ToolResponsePayload) => void;
  /** Callback for followup selection - sends a new prompt */
  onFollowupSelect?: (prompt: string) => void;
}

// Type guards for rendering
function isTextMessage(msg: ChatMessage): msg is TextMessage {
  return msg.role === "assistant" && (msg as TextMessage).variant === "text";
}

function isToolMessage(msg: ChatMessage): msg is ToolMessage {
  return msg.role === "assistant" && (msg as ToolMessage).variant === "tool";
}

function isThinkingMessage(msg: ChatMessage): msg is ThinkingMessage {
  return msg.role === "assistant" && (msg as ThinkingMessage).variant === "thinking";
}

// Tools that should not be rendered in the UI
const HIDDEN_TOOLS = new Set(["set_messages"]);

export function AgentMessageList({
  messages,
  status,
  agent,
  agentIcon: AgentIcon,
  agentName,
  agentColor,
  onToolResponse,
  onFollowupSelect,
}: AgentMessageListProps) {
  const showEmptyState = messages.length === 0;

  return (
    <Conversation className="flex-1">
      <ConversationContent className="gap-6 p-5">
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
              <MessageContent>
                {/* User message */}
                {msg.role === "user" && <MessageResponse>{msg.content}</MessageResponse>}

                {/* Thinking message */}
                {isThinkingMessage(msg) && (
                  <Reasoning isStreaming={msg.isStreaming} duration={msg.duration}>
                    <ReasoningTrigger />
                    <ReasoningContent>{msg.content}</ReasoningContent>
                  </Reasoning>
                )}

                {/* Tool message */}
                {isToolMessage(msg) && !HIDDEN_TOOLS.has(msg.tool.name) && (
                  <Tool defaultOpen>
                    <ToolHeader
                      title={prettifyText(msg.tool.name)}
                      type="tool-invocation"
                      state={msg.tool.status}
                      toolName={msg.tool.name}
                      toolIcon={getToolIcon(agent, msg.tool.name)}
                      toolColor={getToolColor(agent, msg.tool.name)}
                    />
                    <ToolContent className="p-4">
                      <ToolRenderer
                        agent={agent}
                        name={msg.tool.name}
                        input={msg.tool.input}
                        result={msg.tool.result}
                        error={msg.tool.error}
                        status={msg.tool.status}
                        toolId={msg.tool.id}
                        onToolResponse={onToolResponse}
                        onFollowupSelect={onFollowupSelect}
                      />
                    </ToolContent>
                  </Tool>
                )}

                {/* Text message */}
                {isTextMessage(msg) && msg.content && (
                  <MessageResponse>{msg.content}</MessageResponse>
                )}
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
  );
}
