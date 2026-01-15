import { X, Plus, Terminal } from "lucide-react";
import type { TerminalSession } from "@/hooks/useTerminalSessions";
import { cn } from "@/lib/utils";

interface TerminalTabsProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export function TerminalTabs({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onCreate,
}: TerminalTabsProps) {
  const canClose = sessions.length > 1;

  return (
    <div className="flex items-center bg-[#1a1a1a] border-b border-border overflow-x-auto">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;

        return (
          <div
            key={session.id}
            className={cn(
              "flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 group",
              isActive
                ? "bg-[#252525] text-foreground"
                : "bg-[#1a1a1a] text-muted-foreground hover:bg-[#222]"
            )}
            onClick={() => onSelect(session.id)}
          >
            <Terminal className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-sm max-w-[120px]" title={session.name}>
              {session.name}
            </span>
            {canClose && (
              <button
                className={cn(
                  "p-0.5 rounded hover:bg-muted-foreground/20 flex-shrink-0",
                  "opacity-0 group-hover:opacity-100",
                  isActive && "opacity-100"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(session.id);
                }}
                title="Close terminal"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        className="flex items-center justify-center px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-[#222]"
        onClick={onCreate}
        title="New terminal"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
