import { useState, useRef, useCallback, type ChangeEvent } from "react"
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputButton,
  PromptInputSpeechButton,
} from "@/components/ai-elements/prompt-input"
import { useFileTreeContext } from "@/contexts/FileTreeContext"
import { useFileAutocomplete } from "@/hooks/useFileAutocomplete"
import { FileMentionPopover } from "../FileMentionPopover"
import { FilePill } from "../FilePill"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import type { ChatStatus } from "@/hooks/useAgentMessages"
import getCaretCoordinates from "textarea-caret"

export interface AgentPromptInputProps {
  onSubmit: (text: string, attachedFiles: string[]) => void
  disabled: boolean
  status: ChatStatus
  agentIcon: LucideIcon
  agentName: string
  agentColor: string
  placeholder?: string
}

export function AgentPromptInput({
  onSubmit,
  disabled,
  status,
  agentIcon: AgentIcon,
  agentName,
  agentColor,
  placeholder = "Ask anything about your code... (@ to mention files)",
}: AgentPromptInputProps) {
  const [input, setInput] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { searchFiles, isLoading: isLoadingFiles } = useFileTreeContext()
  const autocomplete = useFileAutocomplete()

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)

    const cursor = e.target.selectionStart ?? 0
    const textBeforeCursor = value.slice(0, cursor)
    const atIndex = textBeforeCursor.lastIndexOf("@")

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1)
      const hasSpace = textAfterAt.includes(" ")

      if (!hasSpace) {
        if (!autocomplete.isOpen && textareaRef.current && containerRef.current) {
          const coords = getCaretCoordinates(textareaRef.current, atIndex + 1)
          const textareaRect = textareaRef.current.getBoundingClientRect()
          const containerRect = containerRef.current.getBoundingClientRect()
          autocomplete.open({
            top: textareaRect.top + coords.top - textareaRef.current.scrollTop - containerRect.top,
            left: textareaRect.left + coords.left - containerRect.left,
          })
        }
        autocomplete.setQuery(textAfterAt)
        return
      }
    }

    if (autocomplete.isOpen) {
      autocomplete.close()
    }
  }, [autocomplete])

  const handleFileSelect = useCallback((file: string) => {
    setAttachedFiles(prev => {
      if (prev.includes(file)) return prev
      return [...prev, file]
    })
    setInput(prev => prev.replace(/@[^@]*$/, ""))
    autocomplete.close()
  }, [autocomplete])

  const handleRemoveFile = useCallback((file: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== file))
  }, [])

  const searchResults = searchFiles(autocomplete.query, 15)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.isOpen) {
      switch (e.key) {
        case "Enter":
          e.preventDefault()
          e.stopPropagation()
          if (searchResults.length > 0) {
            handleFileSelect(searchResults[autocomplete.selectedIndex])
          }
          return
        case "Escape":
          e.preventDefault()
          autocomplete.close()
          return
        case "ArrowDown":
          e.preventDefault()
          autocomplete.moveSelection("down", searchResults.length)
          return
        case "ArrowUp":
          e.preventDefault()
          autocomplete.moveSelection("up", searchResults.length)
          return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const form = e.currentTarget.form
      const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null
      if (!submitButton?.disabled) {
        form?.requestSubmit()
      }
    }
  }, [autocomplete, searchResults, handleFileSelect])

  const handleSubmit = useCallback(({ text }: { text: string }) => {
    if (!text.trim()) return
    onSubmit(text.trim(), attachedFiles)
    setInput("")
    setAttachedFiles([])
  }, [onSubmit, attachedFiles])

  const isSubmitDisabled = disabled || !input.trim() || status === "streaming" || status === "submitted"

  return (
    <div ref={containerRef} className="relative w-full px-4 pb-4">
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedFiles.map((file) => (
            <FilePill key={file} path={file} onRemove={() => handleRemoveFile(file)} />
          ))}
        </div>
      )}

      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Connecting..." : placeholder}
            disabled={disabled || status === "streaming" || status === "submitted"}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputSpeechButton textareaRef={textareaRef} />
            <PromptInputButton variant="ghost" disabled>
              <AgentIcon className={cn("size-4", agentColor)} />
              <span>{agentName}</span>
            </PromptInputButton>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={isSubmitDisabled}
            status={status === "ready" ? undefined : status}
          />
        </PromptInputFooter>
      </PromptInput>

      <FileMentionPopover
        open={autocomplete.isOpen}
        position={autocomplete.position}
        files={searchResults}
        loading={isLoadingFiles}
        selectedIndex={autocomplete.selectedIndex}
        onSelect={handleFileSelect}
      />
    </div>
  )
}
