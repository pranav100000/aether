import { useState, useCallback } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { ChevronLeft, Terminal as TerminalIcon } from "lucide-react"
import { useProject } from "@/hooks/useProject"
import { useEditor } from "@/hooks/useEditor"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StatusBadge } from "@/components/projects/StatusBadge"
import { MultiTerminal } from "@/components/workspace/MultiTerminal"
import { FileTree } from "@/components/workspace/FileTree"
import { Editor } from "@/components/workspace/Editor"
import { EditorTabs } from "@/components/workspace/EditorTabs"
import { WorkspaceLayout, WorkspaceEmptyState } from "@/components/workspace/WorkspaceLayout"
import { PreviewButton } from "@/components/workspace/PreviewButton"

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, loading, error, start, stop, refresh } = useProject(id!)
  const {
    openFiles,
    activeFile,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    getFile,
  } = useEditor(id!)
  const [starting, setStarting] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [fileTreeRefreshTrigger, setFileTreeRefreshTrigger] = useState(0)

  const handleFileChange = useCallback(() => {
    setFileTreeRefreshTrigger((prev) => prev + 1)
  }, [])

  const handleStart = async () => {
    setStarting(true)
    try {
      await start()
    } finally {
      setStarting(false)
    }
  }

  const handleFileSelect = useCallback(
    (path: string) => {
      openFile(path)
    },
    [openFile]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeFile) {
        updateContent(activeFile, content)
      }
    },
    [activeFile, updateContent]
  )

  const handleSave = useCallback(() => {
    if (activeFile) {
      saveFile(activeFile)
    }
  }, [activeFile, saveFile])

  const handleCloseFile = useCallback(
    (path: string) => {
      const file = getFile(path)
      if (file?.dirty) {
        if (!confirm(`"${path.split("/").pop()}" has unsaved changes. Close anyway?`)) {
          return
        }
      }
      closeFile(path)
    },
    [closeFile, getFile]
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error || "Project not found"}</p>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Back to projects
          </Button>
        </div>
      </div>
    )
  }

  const activeFileData = activeFile ? getFile(activeFile) : undefined

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <span className="font-medium">{project.name}</span>
          <StatusBadge status={project.status} />
        </div>

        <div className="flex items-center gap-2">
          {project.status === "running" && (
            <PreviewButton projectId={project.id} previewToken={project.preview_token} />
          )}
          {project.status === "running" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTerminalOpen(!terminalOpen)}
                title={terminalOpen ? "Hide terminal" : "Show terminal"}
              >
                <TerminalIcon className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="secondary" onClick={stop}>
                Stop
              </Button>
            </>
          )}
          {project.status === "stopped" && (
            <Button size="sm" onClick={handleStart} loading={starting}>
              Start
            </Button>
          )}
          {project.status === "error" && (
            <Button size="sm" onClick={handleStart} loading={starting}>
              Retry
            </Button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {project.status === "running" ? (
          <WorkspaceLayout
            sidebar={
              <FileTree
                projectId={project.id}
                onFileSelect={handleFileSelect}
                selectedPath={activeFile || undefined}
                refreshTrigger={fileTreeRefreshTrigger}
              />
            }
            editor={
              <>
                <EditorTabs
                  files={openFiles}
                  activeFile={activeFile}
                  onSelect={setActiveFile}
                  onClose={handleCloseFile}
                />
                {activeFileData ? (
                  <div className="flex-1 overflow-hidden">
                    <Editor
                      file={activeFileData}
                      onContentChange={handleContentChange}
                      onSave={handleSave}
                    />
                  </div>
                ) : (
                  <WorkspaceEmptyState />
                )}
              </>
            }
            terminal={<MultiTerminal projectId={project.id} onDisconnect={refresh} onFileChange={handleFileChange} />}
            terminalOpen={terminalOpen}
          />
        ) : project.status === "starting" ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-muted-foreground">Starting your environment...</p>
              <p className="text-muted-foreground/60 text-sm mt-2">
                This may take a few seconds.
              </p>
            </div>
          </div>
        ) : project.status === "stopping" ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-muted-foreground">Stopping your environment...</p>
            </div>
          </div>
        ) : project.status === "error" ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-destructive text-5xl mb-4">!</div>
              <p className="text-destructive mb-2">Failed to start environment</p>
              {project.error_message && (
                <p className="text-muted-foreground text-sm mb-4">
                  {project.error_message}
                </p>
              )}
              <Button onClick={handleStart} loading={starting}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">
                Your environment is stopped.
              </p>
              <Button onClick={handleStart} loading={starting}>
                Start environment
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
