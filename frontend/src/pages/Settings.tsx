import { useState } from "react"
import { cn } from "@/lib/utils"
import { ConnectedAccounts } from "@/components/settings/ConnectedAccounts"

type Tab = "accounts"

const TABS: { id: Tab; label: string }[] = [
  { id: "accounts", label: "Connected Accounts" },
  // Future tabs: { id: "profile", label: "Profile" },
  // Future tabs: { id: "billing", label: "Billing" },
]

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>("accounts")

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="flex gap-8">
        {/* Sidebar navigation */}
        <nav className="w-48 shrink-0">
          <ul className="space-y-1">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    activeTab === tab.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {activeTab === "accounts" && <ConnectedAccounts />}
        </div>
      </div>
    </div>
  )
}
