import {
  RefreshCwIcon,
  SettingsIcon,
  BrainIcon,
  ShieldCheckIcon,
  FileEditIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AgentType, PermissionMode, AgentSettings } from "@/types/agent";
import type { LucideIcon } from "lucide-react";

export interface ModelOption {
  value: string;
  label: string;
}

export interface AgentConfigItem {
  name: string;
  icon: LucideIcon;
  color: string;
  models: ModelOption[];
  defaultModel: string;
}

export interface AgentHeaderProps {
  agent: AgentType;
  agentConfig: Record<AgentType, AgentConfigItem>;
  settings: AgentSettings & { extendedThinking: boolean };
  isConnected: boolean;
  onAgentChange: (agent: AgentType) => void;
  onSettingsChange: (settings: AgentSettings & { extendedThinking: boolean }) => void;
  onReconnect: () => void;
}

export function AgentHeader({
  agent,
  agentConfig,
  settings,
  isConnected,
  onAgentChange,
  onSettingsChange,
  onReconnect,
}: AgentHeaderProps) {
  const currentAgentConfig = agentConfig[agent];
  const AgentIcon = currentAgentConfig.icon;

  return (
    <div className="flex shrink-0 items-center justify-between px-4 py-2">
      <div className="flex items-center gap-2">
        <Select value={agent} onValueChange={(v) => onAgentChange(v as AgentType)}>
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
              const config = agentConfig[agentKey];
              const Icon = config.icon;
              return (
                <SelectItem key={agentKey} value={agentKey}>
                  <div className="flex items-center gap-2">
                    <Icon className={cn("size-4", config.color)} />
                    <span>{config.name}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <span className={cn("size-2 rounded-full", isConnected ? "bg-green-500" : "bg-red-500")} />

        <Select
          value={settings.model ?? currentAgentConfig.defaultModel}
          onValueChange={(v) => onSettingsChange({ ...settings, model: v })}
        >
          <SelectTrigger className="h-8 w-[140px] border-zinc-700 bg-zinc-900 text-xs">
            <SelectValue>
              {currentAgentConfig.models.find((m) => m.value === settings.model)?.label ??
                settings.model}
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
            onClick={onReconnect}
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
              <Select
                value={settings.model ?? currentAgentConfig.defaultModel}
                onValueChange={(v) => onSettingsChange({ ...settings, model: v })}
              >
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
              <Select
                value={settings.permissionMode ?? "default"}
                onValueChange={(v) =>
                  onSettingsChange({ ...settings, permissionMode: v as PermissionMode })
                }
              >
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
                onClick={() =>
                  onSettingsChange({ ...settings, extendedThinking: !settings.extendedThinking })
                }
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
  );
}
