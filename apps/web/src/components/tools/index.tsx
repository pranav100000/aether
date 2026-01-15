"use client";

import type { AgentType, ToolStatus, ToolResponsePayload } from "@/types/agent";
import { CodebuffToolRenderer, getCodebuffToolIcon, getCodebuffToolColor } from "./codebuff";
import { AlertCircleIcon } from "lucide-react";

export interface ToolRendererProps {
  agent: AgentType;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  error?: string;
  /** Current tool status - used for human-in-the-loop tools */
  status?: ToolStatus;
  /** Tool ID - needed for sending responses */
  toolId?: string;
  /** Callback for human-in-the-loop tool responses */
  onToolResponse?: (response: ToolResponsePayload) => void;
}

// Main tool renderer that routes to agent-specific renderers
export function ToolRenderer({
  agent,
  name,
  input,
  result,
  error,
  status,
  toolId,
  onToolResponse,
}: ToolRendererProps) {
  switch (agent) {
    case "codebuff":
      return (
        <CodebuffToolRenderer
          name={name}
          input={input}
          result={result}
          error={error}
          status={status}
          toolId={toolId}
          onToolResponse={onToolResponse}
        />
      );
    // TODO: Add Claude, Codex, OpenCode renderers
    case "claude":
    case "codex":
    case "opencode":
    default:
      // Fall back to Codebuff renderer for now (many tools are similar)
      return (
        <CodebuffToolRenderer
          name={name}
          input={input}
          result={result}
          error={error}
          status={status}
          toolId={toolId}
          onToolResponse={onToolResponse}
        />
      );
  }
}

// Get the icon for a tool based on agent type
export function getToolIcon(agent: AgentType, toolName: string) {
  switch (agent) {
    case "codebuff":
      return getCodebuffToolIcon(toolName);
    // TODO: Add Claude, Codex, OpenCode icon getters
    default:
      return getCodebuffToolIcon(toolName) || AlertCircleIcon;
  }
}

// Get the color for a tool based on agent type
export function getToolColor(agent: AgentType, toolName: string): string {
  switch (agent) {
    case "codebuff":
      return getCodebuffToolColor(toolName);
    // TODO: Add Claude, Codex, OpenCode color getters
    default:
      return getCodebuffToolColor(toolName) || "text-zinc-400";
  }
}

// Re-export shared components
export * from "./shared";
