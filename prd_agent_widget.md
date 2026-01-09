# Agent Widget PRD

**Project:** aether
**Feature:** Agent Widget
**Status:** Draft
**Dependencies:** Phase 4 (Agent Integration) complete

---

## Overview

The Agent Widget is a dedicated UI component for running coding agents (Claude Code, Codex, OpenCode) with an enhanced user experience. Instead of users manually running `claude` or `codex` in a terminal, they get a purpose-built interface with agent-specific controls, better visual feedback, and seamless agent switching.

**Why this matters:**
- Raw terminal interaction with agents is intimidating for new users
- Each agent has different modes/controls (plan mode, model selection, etc.) that benefit from UI
- Users want to quickly switch between agents without managing terminal sessions
- A polished agent experience is our key differentiator

---

## Goals

| Goal | Success Metric |
|------|----------------|
| Reduce friction to use agents | Time from opening workspace to agent interaction <5 seconds |
| Enable easy agent switching | Switch agents in <2 seconds, no command typing needed |
| Surface agent-specific features | Users discover and use plan mode, model selection, etc. |
| Maintain power-user flexibility | Advanced users can still access raw terminal if needed |

---

## User Experience

### Primary Flow

```
User opens workspace
    ↓
Agent Widget visible in bottom panel (replaces or sits alongside terminal)
    ↓
Dropdown shows: Claude Code (default), Codex, OpenCode
    ↓
Click "Start Agent" → agent starts in dedicated terminal view
    ↓
Agent-specific toolbar appears with relevant controls
    ↓
User interacts with agent normally
    ↓
Can switch agents via dropdown (current session ends, new one starts)
```

### Widget Anatomy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐  ┌───────────────────────────────────────────────┐      │
│  │ Claude Code  ▼  │  │  ⚡ Plan Mode   🔄 Compact   ⚙️ Settings      │  ─ □ │
│  └─────────────────┘  └───────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ╭────────────────────────────────────────────────────────────────────────╮  │
│  │  Claude Code v1.0.52                                                   │  │
│  │                                                                        │  │
│  │  I'm ready to help with your project. What would you like to do?      │  │
│  │                                                                        │  │
│  │  > _                                                                   │  │
│  │                                                                        │  │
│  ╰────────────────────────────────────────────────────────────────────────╯  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  💡 Tip: Use /help to see available commands                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Panel Layout Integration

The Agent Widget will be a distinct mode in the bottom panel:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WORKSPACE                                       │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                 │
│   FILES    │                        EDITOR                                   │
│            │                                                                 │
├────────────┴────────────────────────────────────────────────────────────────┤
│  [ Agent ]  [ Terminal 1 ]  [ Terminal 2 ]  [ + ]                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                          AGENT WIDGET                                        │
│                     (when Agent tab selected)                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key decisions:**
- Agent Widget is a **tab** alongside terminal tabs (not replacing terminals)
- Always visible as first tab option
- Clicking "Agent" tab shows the agent widget UI
- Users can still create regular terminal sessions for other tasks

---

## Supported Agents

### 1. Claude Code

**Command:** `claude`

**Agent-Specific Controls:**
| Control | Description | Implementation |
|---------|-------------|----------------|
| Plan Mode | Toggle between plan/execute modes | Send `/plan` or `/execute` command |
| Model Selector | Switch between Opus/Sonnet | Not directly controllable via CLI (uses API key's default) |
| Compact Mode | Toggle compact output | Send `/compact` command |
| Clear Conversation | Reset context | Send `/clear` command |
| Cost Display | Show token/cost usage | Parse from CLI output |

**Detectable States:**
- Idle (waiting for input)
- Thinking (processing)
- Writing code
- In plan mode vs execute mode
- Error state

### 2. Codex (OpenAI)

**Command:** `codex`

**Agent-Specific Controls:**
| Control | Description | Implementation |
|---------|-------------|----------------|
| Model Selector | GPT-4 / GPT-4o | `codex --model gpt-4` |
| Auto-approve | Skip confirmations | `codex --auto-approve` |
| Full-auto | Fully autonomous mode | `codex --full-auto` |

**Detectable States:**
- Idle
- Generating
- Waiting for approval
- Error state

### 3. OpenCode

**Command:** `opencode`

**Agent-Specific Controls:**
| Control | Description | Implementation |
|---------|-------------|----------------|
| Provider | OpenAI / Anthropic / Local | `opencode --provider anthropic` |
| Model | Model selection | `opencode --model claude-sonnet-4-20250514` |
| Approve All | Auto-approve changes | `opencode --approve-all` |

**Detectable States:**
- Idle
- Processing
- Awaiting approval
- Error state

---

## Technical Architecture

### Component Structure

```
frontend/src/components/
├── workspace/
│   ├── AgentWidget/
│   │   ├── AgentWidget.tsx           # Main container component
│   │   ├── AgentSelector.tsx         # Dropdown to switch agents
│   │   ├── AgentToolbar.tsx          # Agent-specific controls bar
│   │   ├── AgentTerminal.tsx         # Terminal view for agent
│   │   ├── AgentStatusBar.tsx        # Status, tips, cost display
│   │   ├── AgentControls/
│   │   │   ├── ClaudeControls.tsx    # Claude-specific buttons
│   │   │   ├── CodexControls.tsx     # Codex-specific buttons
│   │   │   └── OpenCodeControls.tsx  # OpenCode-specific buttons
│   │   └── index.ts
│   └── ...existing components
```

### State Management

New hook: `useAgentWidget.ts`

```typescript
interface AgentWidgetState {
  // Agent selection
  selectedAgent: 'claude' | 'codex' | 'opencode';
  agentStatus: 'stopped' | 'starting' | 'running' | 'error';

  // Session
  sessionId: string | null;
  startedAt: Date | null;

  // Agent-specific state (detected from output)
  agentState: {
    mode?: 'plan' | 'execute';           // Claude
    isCompact?: boolean;                  // Claude
    isAutoApprove?: boolean;             // Codex
    isFullAuto?: boolean;                // Codex
    provider?: string;                    // OpenCode
    model?: string;                       // All
    awaitingApproval?: boolean;          // All
  };

  // Cost tracking (parsed from output)
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
}

interface AgentWidgetActions {
  // Core actions
  selectAgent(agent: 'claude' | 'codex' | 'opencode'): void;
  startAgent(): Promise<void>;
  stopAgent(): void;
  restartAgent(): Promise<void>;

  // Agent commands
  sendCommand(command: string): void;
  togglePlanMode(): void;              // Claude
  toggleCompactMode(): void;           // Claude
  clearConversation(): void;           // Claude
  toggleAutoApprove(): void;           // Codex/OpenCode

  // Terminal passthrough
  focusTerminal(): void;
}
```

### WebSocket Communication

The agent widget uses the same WebSocket terminal connection but adds a message interception layer:

```typescript
// Message types for agent widget
interface AgentMessage {
  type: 'agent_start' | 'agent_stop' | 'agent_command' | 'agent_state_change';
  agent?: string;
  command?: string;
  state?: Partial<AgentWidgetState['agentState']>;
}
```

**Output parsing for state detection:**

```typescript
// Pattern matching for agent state
const CLAUDE_PATTERNS = {
  planMode: /Entering plan mode/i,
  executeMode: /Entering execute mode|Exiting plan mode/i,
  compactOn: /Compact mode: on/i,
  compactOff: /Compact mode: off/i,
  thinking: /Thinking\.\.\./i,
  cost: /Cost: \$(\d+\.\d+)/i,
};

const CODEX_PATTERNS = {
  awaitingApproval: /Do you want to proceed\?|Approve\?/i,
  generating: /Generating\.\.\./i,
};

const OPENCODE_PATTERNS = {
  awaitingApproval: /Apply changes\?|Confirm\?/i,
  processing: /Processing\.\.\./i,
};
```

### Backend Considerations

**No backend changes required for MVP.** The agent widget is purely a frontend enhancement that:
1. Uses existing terminal WebSocket connection
2. Starts agents by sending commands to the terminal
3. Parses terminal output client-side for state detection

**Future backend enhancements (post-MVP):**
- Dedicated agent session API for better lifecycle management
- Server-side output parsing for more reliable state detection
- Agent usage tracking integration (already in Phase 4)

---

## UI Component Specifications

### AgentSelector

```
┌───────────────────────────────┐
│  🤖 Claude Code            ▼  │
└───────────────────────────────┘
         ↓ (on click)
┌───────────────────────────────┐
│  ✓ Claude Code                │
│    Codex                      │
│    OpenCode                   │
├───────────────────────────────┤
│  ⚙️ Agent Settings            │
└───────────────────────────────┘
```

**Behavior:**
- Shows currently selected agent with icon
- Dropdown shows all available agents
- Checkmark indicates current selection
- Disabled while agent is running (must stop first to switch)
- "Agent Settings" links to API key setup if not configured

### AgentToolbar (Claude Code)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [ ⚡ Plan Mode ]  [ 📦 Compact ]  [ 🗑️ Clear ]  │  Cost: $0.12  │  ⚙️  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Button states:**
- Plan Mode: Toggle button, highlighted when active
- Compact: Toggle button, highlighted when active
- Clear: Action button, triggers `/clear` command
- Cost: Read-only display, updated from parsed output
- Settings: Opens agent-specific settings (model selection, etc.)

### AgentToolbar (Codex)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [ ✓ Auto-approve ]  [ 🤖 Full-auto ]  │  Model: GPT-4  ▼  │  ⚙️       │
└──────────────────────────────────────────────────────────────────────────┘
```

### AgentToolbar (OpenCode)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [ ✓ Approve All ]  │  Provider: Anthropic  ▼  │  Model: Sonnet  ▼  │ ⚙️ │
└──────────────────────────────────────────────────────────────────────────┘
```

### AgentStatusBar

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ● Running  │  Session: 5m 23s  │  💡 Use /help for commands            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Status indicators:**
- 🔴 Stopped
- 🟡 Starting...
- 🟢 Running
- 🔵 Thinking/Processing
- 🟠 Awaiting Approval
- 🔴 Error

**Tips (contextual):**
- On start: "Use /help to see available commands"
- In plan mode: "Type your plan, then run /execute to implement"
- Awaiting approval: "Press 'y' to approve or 'n' to reject"

---

## Agent Configuration Storage

**Local storage for preferences:**

```typescript
interface AgentPreferences {
  defaultAgent: 'claude' | 'codex' | 'opencode';
  claude: {
    defaultMode: 'plan' | 'execute';
    compactDefault: boolean;
  };
  codex: {
    autoApprove: boolean;
    fullAuto: boolean;
    model: string;
  };
  opencode: {
    provider: string;
    model: string;
    approveAll: boolean;
  };
}
```

These preferences are stored in localStorage per-user and restored when opening the agent widget.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + A` | Focus Agent Widget |
| `Cmd/Ctrl + Shift + P` | Toggle Plan Mode (Claude) |
| `Cmd/Ctrl + Shift + K` | Clear Agent Conversation |
| `Cmd/Ctrl + Enter` | Send current input to agent |
| `Escape` | Cancel current agent operation (if supported) |

---

## Error Handling

### API Key Not Configured

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│     🔑  API Key Required                                                 │
│                                                                          │
│     To use Claude Code, connect your Anthropic API key.                  │
│                                                                          │
│     [ Connect API Key ]                                                  │
│                                                                          │
│     Get an API key at console.anthropic.com                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Agent Not Installed

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│     ⚠️  Agent Not Found                                                  │
│                                                                          │
│     OpenCode is not installed in this environment.                       │
│                                                                          │
│     [ Install OpenCode ]    [ Use Different Agent ]                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Agent Crash/Error

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│     ❌  Agent Error                                                       │
│                                                                          │
│     Claude Code exited unexpectedly.                                     │
│                                                                          │
│     Error: API rate limit exceeded                                       │
│                                                                          │
│     [ Restart Agent ]    [ View Logs ]                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase A: Foundation (MVP)

**Goal:** Basic agent widget with Claude Code support

| Task | Description |
|------|-------------|
| Create AgentWidget component structure | Shell components, file structure |
| Implement AgentSelector | Dropdown with agent selection |
| Implement AgentTerminal | xterm.js wrapper for agent sessions |
| Add Agent tab to MultiTerminal | Integration with existing terminal tabs |
| Implement start/stop agent lifecycle | Start agent command, detect exit |
| Add basic Claude controls | Plan mode, compact, clear buttons |
| Store agent preferences | localStorage persistence |

### Phase B: Polish

**Goal:** State detection and visual feedback

| Task | Description |
|------|-------------|
| Output parsing for state detection | Regex patterns for each agent |
| AgentStatusBar with real-time status | Running/thinking/awaiting indicators |
| Cost tracking display | Parse and show token usage |
| Contextual tips | Show relevant tips based on state |
| Keyboard shortcuts | Add keyboard navigation |

### Phase C: Additional Agents

**Goal:** Full Codex and OpenCode support

| Task | Description |
|------|-------------|
| CodexControls implementation | Auto-approve, full-auto, model selector |
| OpenCodeControls implementation | Provider, model, approve-all |
| Agent-specific start commands | Handle CLI flags for each agent |
| Error handling for all agents | API key missing, not installed, etc. |

### Phase D: Advanced Features

**Goal:** Enhanced agent experience

| Task | Description |
|------|-------------|
| Agent history/sessions | Save and restore agent sessions |
| Multi-agent workflows | Run multiple agents simultaneously |
| Agent output highlighting | Syntax highlighting for code in output |
| Agent command palette | Quick command access |

---

## File Changes Summary

### New Files

```
frontend/src/components/workspace/AgentWidget/
├── AgentWidget.tsx
├── AgentSelector.tsx
├── AgentToolbar.tsx
├── AgentTerminal.tsx
├── AgentStatusBar.tsx
├── AgentControls/
│   ├── ClaudeControls.tsx
│   ├── CodexControls.tsx
│   └── OpenCodeControls.tsx
├── AgentEmptyState.tsx
├── types.ts
└── index.ts

frontend/src/hooks/
├── useAgentWidget.ts
└── useAgentPreferences.ts

frontend/src/lib/
└── agentPatterns.ts
```

### Modified Files

```
frontend/src/components/workspace/
├── Workspace.tsx            # Add agent widget integration
├── WorkspaceLayout.tsx      # Handle agent tab in bottom panel
├── MultiTerminal.tsx        # Add Agent tab alongside terminal tabs
└── TerminalTabs.tsx         # Update to show agent tab option

frontend/src/hooks/
└── useTerminalSessions.ts   # Add agent session type support
```

---

## Acceptance Criteria

### MVP (Phase A)

- [ ] User can see "Agent" tab in bottom panel
- [ ] User can select from Claude Code, Codex, OpenCode dropdown
- [ ] Clicking "Start" launches selected agent in terminal
- [ ] User can interact with agent normally
- [ ] Claude-specific controls (Plan Mode, Compact, Clear) work
- [ ] User can switch agents (stops current, starts new)
- [ ] Agent preferences persist across sessions
- [ ] Proper error state when API key not configured

### Complete Feature

- [ ] All MVP criteria met
- [ ] Agent status displayed accurately (running, thinking, awaiting approval)
- [ ] Cost tracking shown for Claude
- [ ] Contextual tips displayed based on agent state
- [ ] Keyboard shortcuts functional
- [ ] Codex controls work (auto-approve, full-auto, model)
- [ ] OpenCode controls work (provider, model, approve-all)
- [ ] Graceful error handling for all failure cases
- [ ] Agent sessions tracked in database (Phase 4 integration)

---

## Design Decisions

### Why a tab instead of a separate panel?

1. **Consistency:** Users already understand the terminal tab paradigm
2. **Space efficiency:** No additional panels competing for screen space
3. **Flexibility:** Users can have agent + terminal sessions simultaneously
4. **Familiarity:** Agent widget is still a terminal at its core

### Why client-side output parsing?

1. **Simplicity:** No backend changes needed for MVP
2. **Privacy:** User's agent interactions stay client-side
3. **Speed:** No round-trip latency for state detection
4. **Iteration:** Can improve patterns without backend deploys

### Why not embed agents differently?

We considered:
- **WebView with agent UI:** Would require agent-specific integrations, fragile
- **MCP server approach:** Over-engineered for our use case
- **Custom chat UI:** Loses terminal flexibility power users expect

The terminal-based approach gives us the agent functionality while maintaining the power and flexibility of direct terminal access.

---

## Open Questions

1. **Model selection for Claude:** Claude Code CLI doesn't have a flag to select model. Should we show this control anyway and let the API key default handle it?

2. **Session persistence:** Should we save agent conversation history and allow resuming sessions? This would require backend support.

3. **Multi-agent:** Should users be able to run multiple agents simultaneously in different tabs? MVP says no, but should plan for it.

4. **Agent updates:** How do we handle when agents release new versions with new features/commands? Need update mechanism.

---

## Future Considerations

### Native Agent Integrations

Instead of CLI wrappers, we could integrate directly with agent APIs:
- Claude: Use Anthropic API directly with streaming
- Codex: Use OpenAI API directly
- Benefits: More control, better state management, cost tracking
- Drawbacks: Significant engineering effort, lose CLI features

### Agent Marketplace

Allow third-party agents:
- Users install agents from marketplace
- Agents define their control schema
- Widget dynamically renders controls
- Requires agent API specification

### Collaborative Agents

Multiple users working with same agent:
- Shared agent session
- See each other's prompts/responses
- Useful for pair programming with AI

---

## References

- [Phase 4 PRD - Agent Integration](./prd_phase4.md)
- [Master Plan](./forge_master_plan.md)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://github.com/openai/codex)
- [xterm.js Documentation](https://xtermjs.org/docs/)
