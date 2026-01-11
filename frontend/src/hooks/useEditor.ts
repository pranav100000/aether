import { useState, useCallback, useRef } from "react"
import { api } from "@/lib/api"

export interface OpenFile {
  path: string
  content: string
  originalContent: string
  dirty: boolean
  saving: boolean
  loading: boolean
  error: string | null
}

interface UseEditorReturn {
  openFiles: OpenFile[]
  activeFile: string | null
  openFile: (path: string) => Promise<void>
  closeFile: (path: string) => boolean // returns false if user cancelled due to unsaved changes
  setActiveFile: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  saveAllFiles: () => Promise<void>
  hasUnsavedChanges: () => boolean
  getFile: (path: string) => OpenFile | undefined
}

export function useEditor(vmUrl: string, machineId: string): UseEditorReturn {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const saveTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const getFile = useCallback(
    (path: string): OpenFile | undefined => {
      return openFiles.find((f) => f.path === path)
    },
    [openFiles]
  )

  const openFile = useCallback(
    async (path: string) => {
      // Check if already open
      const existing = openFiles.find((f) => f.path === path)
      if (existing) {
        setActiveFile(path)
        return
      }

      // Add placeholder while loading
      const newFile: OpenFile = {
        path,
        content: "",
        originalContent: "",
        dirty: false,
        saving: false,
        loading: true,
        error: null,
      }

      setOpenFiles((prev) => [...prev, newFile])
      setActiveFile(path)

      try {
        const fileInfo = await api.readFile(vmUrl, machineId, path)
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content: fileInfo.content || "",
                  originalContent: fileInfo.content || "",
                  loading: false,
                }
              : f
          )
        )
      } catch (err) {
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  loading: false,
                  error: err instanceof Error ? err.message : "Failed to load file",
                }
              : f
          )
        )
      }
    },
    [vmUrl, machineId, openFiles]
  )

  const closeFile = useCallback(
    (path: string): boolean => {
      const file = openFiles.find((f) => f.path === path)
      if (file?.dirty) {
        // In a real implementation, you'd show a confirmation dialog
        // For now, we'll just close anyway
        // The component using this hook should handle the confirmation
      }

      // Clear any pending save timeout
      const timeout = saveTimeouts.current.get(path)
      if (timeout) {
        clearTimeout(timeout)
        saveTimeouts.current.delete(path)
      }

      setOpenFiles((prev) => prev.filter((f) => f.path !== path))

      // If this was the active file, switch to another
      if (activeFile === path) {
        const remaining = openFiles.filter((f) => f.path !== path)
        setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
      }

      return true
    },
    [openFiles, activeFile]
  )

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === path
          ? {
              ...f,
              content,
              dirty: content !== f.originalContent,
            }
          : f
      )
    )
  }, [])

  const saveFile = useCallback(
    async (path: string) => {
      const file = openFiles.find((f) => f.path === path)
      if (!file || !file.dirty) return

      setOpenFiles((prev) =>
        prev.map((f) => (f.path === path ? { ...f, saving: true, error: null } : f))
      )

      try {
        await api.writeFile(vmUrl, machineId, path, file.content)
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  originalContent: f.content,
                  dirty: false,
                  saving: false,
                }
              : f
          )
        )
      } catch (err) {
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  saving: false,
                  error: err instanceof Error ? err.message : "Failed to save",
                }
              : f
          )
        )
        throw err
      }
    },
    [vmUrl, machineId, openFiles]
  )

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = openFiles.filter((f) => f.dirty)
    await Promise.all(dirtyFiles.map((f) => saveFile(f.path)))
  }, [openFiles, saveFile])

  const hasUnsavedChanges = useCallback((): boolean => {
    return openFiles.some((f) => f.dirty)
  }, [openFiles])

  return {
    openFiles,
    activeFile,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    saveAllFiles,
    hasUnsavedChanges,
    getFile,
  }
}
