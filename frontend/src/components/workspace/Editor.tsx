import { useEffect, useRef, useCallback } from "react"
import { EditorView, basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { go } from "@codemirror/lang-go"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { oneDark } from "@codemirror/theme-one-dark"
import type { OpenFile } from "@/hooks/useEditor"
import { Spinner } from "@/components/ui/spinner"
import { extname } from "@/lib/path-utils"

interface EditorProps {
  file: OpenFile
  onContentChange: (content: string) => void
  onSave: () => void
}

function getLanguageExtension(path: string): Extension | null {
  const ext = extname(path).slice(1).toLowerCase()

  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript()
    case "jsx":
      return javascript({ jsx: true })
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true })
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "py":
      return python()
    case "go":
      return go()
    case "html":
    case "htm":
      return html()
    case "css":
    case "scss":
    case "less":
      return css()
    case "json":
      return json()
    case "md":
    case "markdown":
      return markdown()
    case "yaml":
    case "yml":
      return yaml()
    default:
      return null
  }
}

export function Editor({ file, onContentChange, onSave }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef(file.content)

  // Use refs for callbacks to avoid stale closures in CodeMirror extensions
  const onSaveRef = useRef(onSave)
  const onContentChangeRef = useRef(onContentChange)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  // Update content ref when file content changes externally
  useEffect(() => {
    contentRef.current = file.content
  }, [file.content])

  // Debounced auto-save
  const scheduleAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      onSaveRef.current()
    }, 2000)
  }, [])

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current || file.loading) return

    // Clean up existing editor
    if (editorRef.current) {
      editorRef.current.destroy()
    }

    const extensions: Extension[] = [
      basicSetup,
      oneDark,
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "14px",
        },
        ".cm-scroller": {
          overflow: "auto",
        },
        ".cm-content": {
          fontFamily: "JetBrains Mono",
        },
        ".cm-gutters": {
          backgroundColor: "#1a1a1a",
          borderRight: "1px solid #333",
        },
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current()
            return true
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString()
          contentRef.current = newContent
          onContentChangeRef.current(newContent)
          scheduleAutoSave()
        }
      }),
    ]

    // Add language extension if available
    const langExtension = getLanguageExtension(file.path)
    if (langExtension) {
      extensions.push(langExtension)
    }

    const state = EditorState.create({
      doc: file.content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    editorRef.current = view

    // Focus the editor
    view.focus()

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      view.destroy()
    }
  }, [file.path, file.loading]) // Recreate when path or loading changes

  // Update editor content when file content changes externally (e.g., after save)
  useEffect(() => {
    if (editorRef.current && !file.loading) {
      const currentContent = editorRef.current.state.doc.toString()
      if (currentContent !== file.content && file.content !== contentRef.current) {
        editorRef.current.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: file.content,
          },
        })
      }
    }
  }, [file.content, file.loading])

  if (file.loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1a1a1a]">
        <Spinner size="lg" />
      </div>
    )
  }

  if (file.error) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1a1a1a]">
        <div className="text-center">
          <p className="text-destructive mb-2">Failed to load file</p>
          <p className="text-muted-foreground text-sm">{file.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full w-full bg-[#1a1a1a]" />
  )
}
