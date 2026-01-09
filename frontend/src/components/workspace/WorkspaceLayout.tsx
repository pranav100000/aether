import { useEffect, useRef } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import type { ImperativePanelHandle } from "react-resizable-panels"

interface WorkspaceLayoutProps {
  sidebar: React.ReactNode
  editor: React.ReactNode
  terminal: React.ReactNode
  leftSidebarOpen: boolean
  terminalOpen: boolean
}

export function WorkspaceLayout({
  sidebar,
  editor,
  terminal,
  leftSidebarOpen,
  terminalOpen,
}: WorkspaceLayoutProps) {
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null)
  const terminalPanelRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    if (sidebarPanelRef.current) {
      if (leftSidebarOpen) {
        sidebarPanelRef.current.expand()
      } else {
        sidebarPanelRef.current.collapse()
      }
    }
  }, [leftSidebarOpen])

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
            <Panel
              ref={sidebarPanelRef}
              defaultSize={20}
              minSize={5}
              maxSize={40}
              collapsible
              collapsedSize={0}
            >
              <div className={`h-full bg-[#1e1e1e] border-r border-border overflow-hidden ${leftSidebarOpen ? '' : 'hidden'}`}>
                {sidebar}
              </div>
            </Panel>

            {/* Resize handle between sidebar and editor */}
            {leftSidebarOpen && (
              <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
            )}

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
          minSize={5}
          maxSize={60}
          collapsible
          collapsedSize={0}
        >
          <div className={`h-full ${terminalOpen ? '' : 'hidden'}`}>
            {terminal}
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
