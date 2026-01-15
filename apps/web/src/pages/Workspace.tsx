import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronLeft, PanelLeft, PanelBottom, PanelRight } from "lucide-react";
import { useProject } from "@/hooks/useProject";
import { useEditor } from "@/hooks/useEditor";
import {
  useWorkspaceConnection,
  type FileOperationsProvider,
} from "@/hooks/useWorkspaceConnection";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/projects/StatusBadge";
import { MultiTerminal } from "@/components/workspace/MultiTerminal";
import { FileTree } from "@/components/workspace/FileTree";
import { Editor } from "@/components/workspace/Editor";
import { EditorTabs } from "@/components/workspace/EditorTabs";
import { WorkspaceLayout, WorkspaceEmptyState } from "@/components/workspace/WorkspaceLayout";
import { PreviewButton } from "@/components/workspace/PreviewButton";
import { AgentChat } from "@/components/workspace/AgentChat";
import { FileTreeProvider } from "@/contexts/FileTreeContext";
import { basename } from "@/lib/path-utils";
import type { Project } from "@/lib/api";

/**
 * Inner component that renders the workspace content (file tree + editor).
 * Manages editor state and file operations via WebSocket connection.
 */
function WorkspaceContent({
  project,
  fileOps,
  onDisconnect,
  onPortChange,
  leftSidebarOpen,
  terminalOpen,
  rightSidebarOpen,
}: {
  project: Project;
  fileOps: FileOperationsProvider;
  onDisconnect: () => void;
  onPortChange: (action: "open" | "close", port: number) => void;
  leftSidebarOpen: boolean;
  terminalOpen: boolean;
  rightSidebarOpen: boolean;
}) {
  // Editor hook with WebSocket file operations
  const {
    openFiles,
    activeFile,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    getFile,
  } = useEditor({ fileOps });

  const handleFileSelect = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeFile) {
        updateContent(activeFile, content);
      }
    },
    [activeFile, updateContent]
  );

  const handleSave = useCallback(() => {
    if (activeFile) {
      saveFile(activeFile);
    }
  }, [activeFile, saveFile]);

  const handleCloseFile = useCallback(
    (path: string) => {
      const file = getFile(path);
      if (file?.dirty) {
        if (!confirm(`"${basename(path)}" has unsaved changes. Close anyway?`)) {
          return;
        }
      }
      closeFile(path);
    },
    [closeFile, getFile]
  );

  const activeFileData = activeFile ? getFile(activeFile) : undefined;

  return (
    <WorkspaceLayout
      sidebar={
        <FileTree
          projectId={project.id}
          onFileSelect={handleFileSelect}
          selectedPath={activeFile || undefined}
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
      terminal={
        <MultiTerminal
          projectId={project.id}
          onDisconnect={onDisconnect}
          onPortChange={onPortChange}
        />
      }
      rightPanel={<AgentChat projectId={project.id} defaultAgent="codebuff" />}
      leftSidebarOpen={leftSidebarOpen}
      terminalOpen={terminalOpen}
      rightPanelOpen={rightSidebarOpen}
    />
  );
}

/**
 * Connected workspace that handles WebSocket connection and renders content.
 */
function ConnectedWorkspace({
  project,
  onDisconnect,
  leftSidebarOpen,
  terminalOpen,
  rightSidebarOpen,
  onPortChange,
  onKillPortReady,
}: {
  project: Project;
  onDisconnect: () => void;
  leftSidebarOpen: boolean;
  terminalOpen: boolean;
  rightSidebarOpen: boolean;
  onPortChange: (action: "open" | "close", port: number) => void;
  onKillPortReady: (killPort: (port: number) => Promise<void>) => void;
}) {
  const [fileTreeChangeHandler, setFileTreeChangeHandler] = useState<
    ((action: string, path: string, isDirectory: boolean) => void) | null
  >(null);

  // Connect to workspace via WebSocket
  const workspace = useWorkspaceConnection({
    projectId: project.id,
    onFileChange: fileTreeChangeHandler || undefined,
    onPortChange,
  });

  // Auto-connect when mounted
  useEffect(() => {
    workspace.connect();
    return () => workspace.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when killPort is ready
  useEffect(() => {
    if (workspace.status === "connected") {
      onKillPortReady(workspace.killPort);
    }
  }, [workspace.status, workspace.killPort, onKillPortReady]);

  // Create file operations provider from workspace connection
  const fileOps: FileOperationsProvider | undefined = useMemo(() => {
    if (workspace.status !== "connected") return undefined;
    return {
      readFile: workspace.readFile,
      writeFile: workspace.writeFile,
      listFiles: workspace.listFiles,
      listFilesTree: workspace.listFilesTree,
      mkdir: workspace.mkdir,
      deleteFile: workspace.deleteFile,
      renameFile: workspace.renameFile,
    };
  }, [
    workspace.status,
    workspace.readFile,
    workspace.writeFile,
    workspace.listFiles,
    workspace.listFilesTree,
    workspace.mkdir,
    workspace.deleteFile,
    workspace.renameFile,
  ]);

  // Show connecting state
  if (workspace.status === "connecting" || workspace.status === "disconnected") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" className="mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to workspace...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (workspace.status === "error") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-destructive text-5xl mb-4">!</div>
          <p className="text-destructive mb-2">Failed to connect to workspace</p>
          {workspace.error && (
            <p className="text-muted-foreground text-sm mb-4">{workspace.error}</p>
          )}
          <Button onClick={() => workspace.connect()}>Retry</Button>
        </div>
      </div>
    );
  }

  // Connected - render workspace with file operations
  return (
    <FileTreeProvider
      projectId={project.id}
      fileOps={fileOps}
      // Wrap in arrow function to avoid React's setState updater function behavior
      // (passing a function directly to setState makes React call it with prev state)
      onHandleFileChangeReady={(handler) => setFileTreeChangeHandler(() => handler)}
    >
      {fileOps && (
        <WorkspaceContent
          project={project}
          fileOps={fileOps}
          onDisconnect={onDisconnect}
          onPortChange={onPortChange}
          leftSidebarOpen={leftSidebarOpen}
          terminalOpen={terminalOpen}
          rightSidebarOpen={rightSidebarOpen}
        />
      )}
    </FileTreeProvider>
  );
}

export function Workspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, loading, error, start, stop, refresh } = useProject(id!);
  const [starting, setStarting] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [activePorts, setActivePorts] = useState<number[]>([]);
  const [killPort, setKillPort] = useState<((port: number) => Promise<void>) | null>(null);

  const handleKillPortReady = useCallback((fn: (port: number) => Promise<void>) => {
    setKillPort(() => fn);
  }, []);

  const handlePortChange = useCallback((action: "open" | "close", port: number) => {
    setActivePorts((prev) => {
      if (action === "open") {
        return prev.includes(port) ? prev : [...prev, port].sort((a, b) => a - b);
      } else {
        return prev.filter((p) => p !== port);
      }
    });
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      await start();
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
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
    );
  }

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
          {project.status === "running" && killPort && (
            <PreviewButton
              projectId={project.id}
              activePorts={activePorts}
              previewToken={project.preview_token}
              onKillPort={killPort}
            />
          )}
          {project.status === "running" && (
            <>
              <div className="flex items-center gap-1 mr-2">
                <Button
                  size="sm"
                  variant={leftSidebarOpen ? "secondary" : "ghost"}
                  onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                  title={leftSidebarOpen ? "Hide file tree" : "Show file tree"}
                >
                  <PanelLeft className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant={terminalOpen ? "secondary" : "ghost"}
                  onClick={() => setTerminalOpen(!terminalOpen)}
                  title={terminalOpen ? "Hide terminal" : "Show terminal"}
                >
                  <PanelBottom className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant={rightSidebarOpen ? "secondary" : "ghost"}
                  onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                  title={rightSidebarOpen ? "Hide right panel" : "Show right panel"}
                >
                  <PanelRight className="w-4 h-4" />
                </Button>
              </div>
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
          <ConnectedWorkspace
            project={project}
            onDisconnect={refresh}
            leftSidebarOpen={leftSidebarOpen}
            terminalOpen={terminalOpen}
            rightSidebarOpen={rightSidebarOpen}
            onPortChange={handlePortChange}
            onKillPortReady={handleKillPortReady}
          />
        ) : project.status === "starting" ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-muted-foreground">Starting your environment...</p>
              <p className="text-muted-foreground/60 text-sm mt-2">This may take a few seconds.</p>
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
                <p className="text-muted-foreground text-sm mb-4">{project.error_message}</p>
              )}
              <Button onClick={handleStart} loading={starting}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">Your environment is stopped.</p>
              <Button onClick={handleStart} loading={starting}>
                Start environment
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
