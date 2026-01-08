import { useEffect, useRef } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { Terminal as TerminalIcon, ChevronDown, ChevronUp } from "lucide-react"

interface WorkspaceLayoutProps {
  sidebar: React.ReactNode
  editor: React.ReactNode
  terminal: React.ReactNode
  terminalOpen: boolean
  onToggleTerminal: () => void
}

export function WorkspaceLayout({
  sidebar,
  editor,
  terminal,
  terminalOpen,
  onToggleTerminal,
}: WorkspaceLayoutProps) {
  const terminalPanelRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    if (terminalPanelRef.current) {
      if (terminalOpen) {
        terminalPanelRef.current.expand()
      } else {
        terminalPanelRef.current.collapse()
      }
    }
  }, [terminalOpen])

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a]">
      <PanelGroup direction="vertical" className="flex-1">
        {/* Main content area (sidebar + editor) */}
        <Panel defaultSize={70} minSize={30}>
          <PanelGroup direction="horizontal" className="h-full">
            {/* Sidebar (File Tree) */}
            <Panel defaultSize={20} minSize={15} maxSize={40}>
              <div className="h-full bg-[#1e1e1e] border-r border-border overflow-hidden">
                {sidebar}
              </div>
            </Panel>

            {/* Resize handle between sidebar and editor */}
            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

            {/* Editor area */}
            <Panel defaultSize={80} minSize={40}>
              <div className="h-full flex flex-col overflow-hidden">
                {editor}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        {/* Resize handle between editor and terminal - only show when terminal is open */}
        {terminalOpen && (
          <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />
        )}

        {/* Terminal panel */}
        <Panel
          ref={terminalPanelRef}
          defaultSize={30}
          minSize={15}
          maxSize={60}
          collapsible
          collapsedSize={0}
        >
          <div className="h-full flex flex-col bg-[#1a1a1a]">
            {/* Terminal header */}
            <div
              className="flex items-center justify-between px-3 py-1.5 bg-[#252525] border-t border-border cursor-pointer"
              onClick={onToggleTerminal}
            >
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Terminal
                </span>
              </div>
              <button className="p-0.5 rounded hover:bg-muted">
                {terminalOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Terminal content - always mounted, visibility controlled by CSS */}
            <div className={`flex-1 overflow-hidden ${terminalOpen ? '' : 'hidden'}`}>
              {terminal}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}

interface WorkspaceEmptyStateProps {
  message?: string
}

export function WorkspaceEmptyState({ message = "Select a file to start editing" }: WorkspaceEmptyStateProps) {
  return (
    <div className="h-full flex items-center justify-center bg-[#1a1a1a]">
      <div className="text-center">
        <p className="text-muted-foreground text-sm">{message}</p>
      </div>
    </div>
  )
}
