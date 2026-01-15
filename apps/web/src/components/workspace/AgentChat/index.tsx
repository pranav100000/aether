import { useState, useCallback } from "react"
import { SparklesIcon, ZapIcon, BrainIcon } from "lucide-react"
import { useAgentConnection } from "@/hooks/useAgentConnection"
import { useAgentMessages } from "@/hooks/useAgentMessages"
import { AgentHeader, type AgentConfigItem } from "./AgentHeader"
import { AgentMessageList } from "./AgentMessageList"
import { AgentPromptInput } from "./AgentPromptInput"
import type { AgentType, AgentSettings, ServerMessage } from "@/types/agent"

// Agent configuration
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
      { value: "sonnet-4.5", label: "Claude Sonnet 4.5 (Latest)" },
      { value: "sonnet-4", label: "Claude Sonnet 4" },
      { value: "opus-4", label: "Claude Opus 4 (Powerful)" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast)" },
    ],
    defaultModel: "sonnet-4.5",
  },
  opencode: {
    name: "OpenCode",
    icon: BrainIcon,
    color: "text-blue-400",
    models: [
      { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { value: "anthropic/claude-opus-4", label: "Claude Opus 4" },
    ],
    defaultModel: "anthropic/claude-sonnet-4",
  },
}

export interface AgentChatProps {
  projectId: string
  defaultAgent?: AgentType
}

export function AgentChat({ projectId, defaultAgent = "claude" }: AgentChatProps) {
  const [agent, setAgent] = useState<AgentType>(defaultAgent)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AgentSettings & { extendedThinking: boolean }>(() => ({
    model: agentConfig[defaultAgent].defaultModel,
    permissionMode: "bypassPermissions",
    extendedThinking: true,
  }))

  const {
    messages,
    status,
    handleServerMessage,
    addUserMessage,
    setStatus,
    clear: clearMessages,
  } = useAgentMessages()

  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.type === "error" && message.error) {
      setError(message.error)
    } else {
      setError(null)
    }
    handleServerMessage(message)
  }, [handleServerMessage])

  const handleError = useCallback((err: string) => {
    setError(err)
    setStatus("error")
  }, [setStatus])

  const {
    status: connectionStatus,
    connect,
    sendPrompt,
    sendAbort,
  } = useAgentConnection({
    projectId,
    agent,
    onMessage: handleMessage,
    onError: handleError,
  })

  const isConnected = connectionStatus === "connected"
  const currentAgentConfig = agentConfig[agent]

  const handleAgentChange = useCallback((newAgent: AgentType) => {
    if (newAgent === agent) return

    // Clear messages when switching agents
    clearMessages()
    setError(null)

    // Reset model to new agent's default
    setSettings(s => ({
      ...s,
      model: agentConfig[newAgent].defaultModel,
    }))

    // Switch agent (this will trigger reconnection via useEffect in useAgentConnection)
    setAgent(newAgent)
  }, [agent, clearMessages])

  const handleSubmit = useCallback((text: string, attachedFiles: string[]) => {
    if (!text.trim() || !isConnected) return

    addUserMessage(text.trim())

    sendPrompt(
      text.trim(),
      {
        model: settings.model,
        permissionMode: settings.permissionMode,
        extendedThinking: settings.extendedThinking,
      },
      attachedFiles.length > 0
        ? { files: attachedFiles.map(path => ({ path, include: true })) }
        : undefined
    )
  }, [isConnected, addUserMessage, sendPrompt, settings])

  const handleStop = useCallback(() => {
    sendAbort()
    setStatus("ready")
  }, [sendAbort, setStatus])

  return (
    <div className="relative flex size-full flex-col divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
      <AgentHeader
        agent={agent}
        agentConfig={agentConfig}
        settings={settings}
        isConnected={isConnected}
        onAgentChange={handleAgentChange}
        onSettingsChange={setSettings}
        onReconnect={connect}
      />

      <AgentMessageList
        messages={messages}
        status={status}
        agent={agent}
        agentIcon={currentAgentConfig.icon}
        agentName={currentAgentConfig.name}
        agentColor={currentAgentConfig.color}
      />

      {error && (
        <div className="shrink-0 bg-red-900/50 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid shrink-0 gap-4 pt-4">
        <AgentPromptInput
          onSubmit={handleSubmit}
          onStop={handleStop}
          disabled={!isConnected}
          status={status}
          agentIcon={currentAgentConfig.icon}
          agentName={currentAgentConfig.name}
          agentColor={currentAgentConfig.color}
        />
      </div>
    </div>
  )
}

// Re-export components for flexibility
export { AgentHeader } from "./AgentHeader"
export { AgentMessageList } from "./AgentMessageList"
export { AgentPromptInput } from "./AgentPromptInput"
