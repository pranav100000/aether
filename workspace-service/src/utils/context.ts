export type FileContextFormat = "xml" | "markdown"

interface FileContext {
  path: string
  content?: string
  selection?: { startLine: number; endLine: number }
}

interface FormatOptions {
  format: FileContextFormat
}

/**
 * Build a file context section for an agent prompt
 */
export function buildFileContextSection(
  fileContext: FileContext[] | undefined,
  options: FormatOptions = { format: "markdown" }
): string {
  if (!fileContext || fileContext.length === 0) return ""

  let section = "The user has provided the following files as context:\n\n"

  for (const file of fileContext) {
    if (file.content) {
      const selectionInfo = file.selection
        ? ` (lines ${file.selection.startLine}-${file.selection.endLine})`
        : ""
      const selectionAttr = file.selection
        ? ` lines="${file.selection.startLine}-${file.selection.endLine}"`
        : ""

      if (options.format === "xml") {
        section += `<file path="${file.path}"${selectionAttr}>\n${file.content}\n</file>\n\n`
      } else {
        section += `File: ${file.path}${selectionInfo}\n\`\`\`\n${file.content}\n\`\`\`\n\n`
      }
    } else {
      if (options.format === "xml") {
        section += `<file path="${file.path}" />\n`
      } else {
        section += `File reference: ${file.path}\n\n`
      }
    }
  }

  return section
}

/**
 * Build a conversation history section for an agent prompt
 */
export function buildConversationHistorySection(
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined
): string {
  if (!history || history.length === 0) return ""

  const historyText = history
    .map((msg) => `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`)
    .join("\n\n")

  return `<conversation_history>\n${historyText}\n</conversation_history>\n\n`
}

/**
 * Build a full prompt with file context and conversation history
 */
export function buildFullPrompt(
  prompt: string,
  fileContext: FileContext[] | undefined,
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
  format: FileContextFormat = "markdown"
): string {
  const fileContextSection = buildFileContextSection(fileContext, { format })
  const historySection = buildConversationHistorySection(history)

  let fullPrompt = prompt

  if (fileContextSection) {
    fullPrompt = `${fileContextSection}\n${prompt}`
  }

  if (historySection) {
    fullPrompt = `${historySection}Human: ${fullPrompt}`
  }

  return fullPrompt
}
