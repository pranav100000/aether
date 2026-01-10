import { useState } from "react"
import type { Provider, UserIdentity } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { GoogleIcon } from "@/components/icons/GoogleIcon"
import { GithubIcon } from "@/components/icons/GithubIcon"
import { EmailIcon } from "@/components/icons/EmailIcon"

interface LinkedAccountInfo {
  provider: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  isOAuth: boolean
}

const LINKED_ACCOUNTS: LinkedAccountInfo[] = [
  {
    provider: "email",
    name: "Email",
    description: "Primary account identifier",
    icon: EmailIcon,
    isOAuth: false,
  },
  {
    provider: "google",
    name: "Google",
    description: "Sign in with your Google account",
    icon: GoogleIcon,
    isOAuth: true,
  },
  {
    provider: "github",
    name: "GitHub",
    description: "Sign in with your GitHub account",
    icon: GithubIcon,
    isOAuth: true,
  },
]

interface AccountCardProps {
  account: LinkedAccountInfo
  identity: UserIdentity | undefined
  isConnected: boolean
  canDisconnect: boolean
  onConnect: () => Promise<void>
  onDisconnect: (identity: UserIdentity) => Promise<void>
}

function AccountCard({
  account,
  identity,
  isConnected,
  canDisconnect,
  onConnect,
  onDisconnect,
}: AccountCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)

  const Icon = account.icon

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    try {
      await onConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect")
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!identity) return
    setLoading(true)
    setError(null)
    try {
      await onDisconnect(identity)
      setShowDisconnectDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                )}
                <h3 className="font-medium">{account.name}</h3>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {account.description}
              </p>
            </div>
          </div>

          {account.isOAuth && (
            <div>
              {isConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={loading || !canDisconnect}
                  title={
                    !canDisconnect
                      ? "Cannot disconnect last sign-in method"
                      : undefined
                  }
                >
                  {loading ? <Spinner size="sm" /> : "Disconnect"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  disabled={loading}
                >
                  {loading ? <Spinner size="sm" /> : "Connect"}
                </Button>
              )}
            </div>
          )}
        </div>

        {isConnected && identity?.identity_data?.email && (
          <p className="text-sm text-muted-foreground">
            Connected as {identity.identity_data.email}
          </p>
        )}

        {!account.isOAuth && isConnected && (
          <p className="text-sm text-muted-foreground">
            Always connected — primary sign-in method
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {account.name}?</DialogTitle>
            <DialogDescription>
              You will no longer be able to sign in using your {account.name}{" "}
              account. You can reconnect it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
              {loading ? <Spinner size="sm" /> : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function LinkedAccounts() {
  const { user, loading, linkIdentity, unlinkIdentity, getIdentityByProvider } =
    useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  const identities = user?.identities ?? []
  const totalLinkedCount = identities.length

  const handleConnect = async (provider: Provider) => {
    await linkIdentity(provider)
  }

  const handleDisconnect = async (identity: UserIdentity) => {
    await unlinkIdentity(identity)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Linked Accounts</h2>
        <p className="text-sm text-muted-foreground">
          Manage how you sign in to your account. You can link multiple
          providers.
        </p>
      </div>

      <div className="space-y-4">
        {LINKED_ACCOUNTS.map((account) => {
          const identity = getIdentityByProvider(account.provider)
          const isConnected = !!identity
          const canDisconnect = totalLinkedCount > 1

          return (
            <AccountCard
              key={account.provider}
              account={account}
              identity={identity}
              isConnected={isConnected}
              canDisconnect={canDisconnect}
              onConnect={() => handleConnect(account.provider as Provider)}
              onDisconnect={handleDisconnect}
            />
          )
        })}
      </div>
    </div>
  )
}
