import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useApiKeys } from "@/hooks/useApiKeys"
import { LinkedAccounts } from "./LinkedAccounts"
import type { ConnectedProvider } from "@/lib/api"

const PROVIDER_INFO: Record<string, { name: string; description: string; placeholder: string; helpUrl: string }> = {
  anthropic: {
    name: "Anthropic (Claude)",
    description: "Use Claude Code CLI in your projects",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/",
  },
  openai: {
    name: "OpenAI (Codex)",
    description: "Use Codex and other OpenAI tools",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  openrouter: {
    name: "OpenRouter",
    description: "Access multiple AI models through a unified API",
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
  },
}

interface ProviderCardProps {
  provider: ConnectedProvider
  onConnect: (apiKey: string) => Promise<void>
  onDisconnect: () => Promise<void>
}

function ProviderCard({ provider, onConnect, onDisconnect }: ProviderCardProps) {
  const [apiKey, setApiKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const info = PROVIDER_INFO[provider.provider]
  if (!info) return null

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError("API key is required")
      return
    }

    setLoading(true)
    setError(null)
    try {
      await onConnect(apiKey)
      setApiKey("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect")
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setLoading(true)
    setError(null)
    try {
      await onDisconnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {provider.connected ? (
              <div className="w-2 h-2 rounded-full bg-green-500" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-400" />
            )}
            <h3 className="font-medium">{info.name}</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{info.description}</p>
        </div>
        {provider.connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={loading}
          >
            {loading ? <Spinner size="sm" /> : "Disconnect"}
          </Button>
        )}
      </div>

      {provider.connected ? (
        <p className="text-sm text-muted-foreground">
          Connected{provider.added_at && ` on ${new Date(provider.added_at).toLocaleDateString()}`}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={info.placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleConnect} disabled={loading || !apiKey.trim()}>
              {loading ? <Spinner size="sm" /> : "Connect"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your API key from{" "}
            <a
              href={info.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {info.helpUrl.replace("https://", "")}
            </a>
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}

export function ConnectedAccounts() {
  const { providers, loading, error, addKey, removeKey } = useApiKeys()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <LinkedAccounts />

      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Connect your AI provider accounts to use coding agents in your projects.
          </p>
        </div>

        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.provider}
              provider={provider}
              onConnect={(apiKey) => addKey(provider.provider, apiKey)}
              onDisconnect={() => removeKey(provider.provider)}
            />
          ))}
        </div>

        <div className="border rounded-lg p-4 bg-muted/50">
          <div className="flex items-start gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 text-muted-foreground"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p className="text-sm text-muted-foreground">
              Your API keys are encrypted and only used to run agents in your cloud environments.
              We never access your keys for any other purpose.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
