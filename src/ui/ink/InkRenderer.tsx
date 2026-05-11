/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * InkRenderer - Manages the Ink render instance and state updates
 * This provides an imperative API for the agent to control the UI
 *
 * Key optimization: Uses React state internally via ref/useImperativeHandle
 * instead of calling instance.rerender() on every state change. This eliminates
 * flickering by letting React handle efficient DOM updates.
 */
import React, { useState, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { render, type Instance } from 'ink';
import {
  AgentUI,
  createInitialUIState,
  type AgentUILineExtensions,
  type AgentUIState,
} from './AgentUI.js';
import type { LiveCommandEntry, ToolOutputEntry, ToolOutputBatchEntry, ToolOutputItem, BatchToolItem } from './ToolOutput.js';
import type { SlashCommand } from '../../core/slashCommandTypes.js';
import type { SkillMentionInfo } from '../mentionFilter.js';
import { ThemeProvider } from '../theme/ThemeContext.js';
import { I18nProvider } from '../i18n/index.js';
import { inkRenderOptions } from '../inkRenderOptions.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { safeSetRawMode } from '../rawMode.js';
import type { ChatLogMessage } from '../../session/chatLog.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';

export interface InkRendererOptions {
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  enableQueueInput?: boolean;
  /** Called when a dragged/dropped image is detected in the input */
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  /** Provider for file list used in @ mention autocomplete */
  filesProvider?: () => string[];
  /** Slash commands for / autocomplete */
  slashCommands?: SlashCommand[];
  /** Provider for skill list used in $ mention autocomplete */
  skillsProvider?: () => SkillMentionInfo[];
  /** Base path used for shell path completion. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Lazy provider for the current next-step suggestion shown as ghost text. */
  suggestionProvider?: () => string | undefined;
  /** Optional async LLM resolver for ! command suggestions. */
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  /** Optional extension points for status/help lines. */
  lineExtensions?: AgentUILineExtensions;
}

/**
 * Ref handle exposed by AgentUIWrapper for imperative state updates
 */
export interface AgentUIWrapperHandle {
  updateState: (partial: Partial<AgentUIState>) => void;
  getState: () => AgentUIState;
}

interface AgentUIWrapperProps {
  initialState: AgentUIState;
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  onToggleLiveCommandExpanded: () => void;
  onInputChange: (input: string) => void;
  enableQueueInput?: boolean;
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  filesProvider?: () => string[];
  slashCommands?: SlashCommand[];
  skillsProvider?: () => SkillMentionInfo[];
  workspaceRoot?: string;
  suggestionProvider?: () => string | undefined;
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  lineExtensions?: AgentUILineExtensions;
}

/**
 * Wrapper component that holds state internally and exposes update methods via ref.
 * This eliminates the need to call instance.rerender() - React handles updates.
 */
const AgentUIWrapper = forwardRef<AgentUIWrapperHandle, AgentUIWrapperProps>(
  function AgentUIWrapper(props, ref) {
    const {
      initialState,
      onInstruction,
      onEscape,
      onCtrlC,
      onToggleLiveCommandExpanded,
      onInputChange,
      enableQueueInput,
      onImageDetected,
      filesProvider,
      slashCommands,
      skillsProvider,
      workspaceRoot,
      suggestionProvider,
      resolveShellSuggestion,
      lineExtensions,
    } = props;

    const [state, setState] = useState<AgentUIState>(initialState);

    // Use ref to always get latest state without recreating the handle
    const stateRef = useRef<AgentUIState>(state);
    stateRef.current = state;

    // Expose imperative methods via ref - stable functions that don't change
    useImperativeHandle(ref, () => ({
      updateState: (partial: Partial<AgentUIState>) => {
        setState(prev => ({ ...prev, ...partial }));
      },
      getState: () => stateRef.current
    }), []); // Empty deps - functions are stable

    // Handle input changes - sync to parent for pause/resume preservation
    const handleInputChange = useCallback((input: string) => {
      setState(prev => ({ ...prev, currentInput: input }));
      onInputChange(input);
    }, [onInputChange]);

    return (
      <AgentUI
        state={state}
        onInstruction={onInstruction}
        onEscape={onEscape}
        onCtrlC={onCtrlC}
        onToggleLiveCommandExpanded={onToggleLiveCommandExpanded}
        onInputChange={handleInputChange}
        enableQueueInput={enableQueueInput}
        onImageDetected={onImageDetected}
        filesProvider={filesProvider}
        slashCommands={slashCommands}
        skillsProvider={skillsProvider}
        workspaceRoot={workspaceRoot}
        suggestionProvider={suggestionProvider}
        resolveShellSuggestion={resolveShellSuggestion}
        lineExtensions={lineExtensions}
      />
    );
  }
);

/**
 * Patch process.stdout.write to wrap terminal output in DEC Mode 2026
 * (Synchronized Output). This batches all writes within a single microtask
 * into one atomic terminal update, eliminating flicker from partial frames.
 *
 * Inspired by pi-mono's TUI differential renderer:
 * https://github.com/badlogic/pi-mono/blob/main/packages/tui/src/tui.ts
 *
 * On unsupported terminals the CSI sequences are silently ignored, so this
 * is safe to enable unconditionally.
 */
function patchStdoutForSyncOutput(): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let syncActive = false;
  let pendingEnd = false;

  const endSync = () => {
    if (pendingEnd) {
      pendingEnd = false;
      syncActive = false;
      originalWrite('\x1b[?2026l');
    }
  };

  const patchedWrite = function (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
    cb?: (err?: Error) => void
  ): boolean {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    if (!str || str.length === 0) {
      return originalWrite.call(process.stdout, chunk, encoding as any, cb as any);
    }

    if (!syncActive) {
      syncActive = true;
      originalWrite('\x1b[?2026h');
    }
    pendingEnd = true;

    const result = originalWrite.call(process.stdout, chunk, encoding as any, cb as any);
    queueMicrotask(endSync);
    return result;
  };

  process.stdout.write = patchedWrite as any;

  return () => {
    process.stdout.write = originalWrite;
    if (syncActive) {
      originalWrite('\x1b[?2026l');
    }
  };
}

/**
 * InkRenderer wraps the Ink render instance and provides
 * imperative methods to update the UI state from the agent.
 *
 * Optimized to use React state internally - only calls render() once on start,
 * then uses ref-based state updates for all subsequent changes.
 */
export class InkRenderer {
  private instance: Instance | null = null;
  private state: AgentUIState;
  private options: InkRendererOptions;
  private toolIdCounter = 0;
  private wrapperRef: React.RefObject<AgentUIWrapperHandle | null>;
  /** Pending live command output buffers (accumulated between flushes) */
  private pendingLiveOutput = new Map<string, { stdout: string; stderr: string }>();
  /** Timer for throttling live command output flushes */
  private liveOutputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Flush interval in ms - batches rapid output to prevent flickering */
  private static readonly LIVE_OUTPUT_FLUSH_INTERVAL_MS = 100;

  private static readonly DUPLICATE_INSTRUCTION_SUPPRESSION_MS = 1000;

  /** Resize handler reference for cleanup */
  private resizeHandler: (() => void) | null = null;

  /** Debounce timer for drag-resize events */
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounce time for resize events (ms) - longer to batch drag-resize */
  private static readonly RESIZE_DEBOUNCE_MS = 150;

  /** Cleanup function for stdout sync-output patch */
  private unpatchedStdout: (() => void) | null = null;

  private lastQueuedInstruction: { text: string; at: number } | null = null;

  constructor(options: InkRendererOptions) {
    this.options = options;
    this.state = {
      ...createInitialUIState(),
      lineExtensions: options.lineExtensions,
    };
    this.wrapperRef = React.createRef<AgentUIWrapperHandle>();
  }

  /**
   * Handle input changes from AgentUI to preserve across pause/resume
   */
  private handleInputChange = (input: string): void => {
    this.state = { ...this.state, currentInput: input };
  };

/**
   * Handle resize events with debouncing to prevent flickering during drag-resize.
   * Ink handles re-renders naturally - we just need to debounce rapid events.
   */
  private onResize = () => {
    // Debounce rapid events during drag-resize to prevent multiple re-renders
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = setTimeout(() => {
      this.resizeDebounceTimer = null;
      // Let Ink handle the re-render naturally - no screen clear needed
    }, InkRenderer.RESIZE_DEBOUNCE_MS);
  };

  /**
   * Start the Ink renderer
   */
  start(): void {
    if (this.instance) {
      return;
    }

    // Enable synchronized output wrapping to eliminate flicker from partial
    // frame updates. Must happen before Ink starts writing to stdout.
    this.unpatchedStdout = patchStdoutForSyncOutput();

    // Install our resize guard BEFORE Ink registers its own handler.
    // Node.js event listeners fire in registration order.
    this.resizeHandler = this.onResize;
    if (typeof process.stdout.on === 'function') {
      process.stdout.on('resize', this.resizeHandler);
    }

    this.instance = render(
      <ThemeProvider>
        <I18nProvider>
          <AgentUIWrapper
            ref={this.wrapperRef}
            initialState={this.state}
            onInstruction={this.options.onInstruction}
            onEscape={this.options.onEscape}
            onCtrlC={this.options.onCtrlC}
            onToggleLiveCommandExpanded={() => this.toggleActiveLiveCommandExpanded()}
            onInputChange={this.handleInputChange}
            enableQueueInput={this.options.enableQueueInput}
            onImageDetected={this.options.onImageDetected}
            filesProvider={this.options.filesProvider}
            slashCommands={this.options.slashCommands}
            skillsProvider={this.options.skillsProvider}
            workspaceRoot={this.options.workspaceRoot}
            suggestionProvider={this.options.suggestionProvider}
            resolveShellSuggestion={this.options.resolveShellSuggestion}
            lineExtensions={this.options.lineExtensions}
          />
        </I18nProvider>
      </ThemeProvider>,
      inkRenderOptions({
        // Ensure Ink handles stdin for input capture
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        // Let AgentUI handle Ctrl+C (clear text / warn-then-exit) instead of Ink forcing exit
        exitOnCtrlC: false
      })
    );
  }

  /**
   * Stop the Ink renderer and cleanup
   */
  stop(): void {
    if (this.instance) {
      const instance = this.instance;
      try {
        instance.clear();
      } finally {
        instance.unmount();
      }
      this.instance = null;
    }

    if (
      this.resizeHandler &&
      typeof process.stdout.off === 'function'
    ) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    if (this.unpatchedStdout) {
      this.unpatchedStdout();
      this.unpatchedStdout = null;
    }

    // Clear any pending instruction waiter to prevent dangling promises
    this._instructionWaiter = null;
  }

  /**
   * Update the UI state via React's internal state management
   * This is much more efficient than calling instance.rerender()
   */
  private updateState(partial: Partial<AgentUIState>): void {
    this.state = { ...this.state, ...partial };

    // Use React state update if wrapper is mounted
    if (this.wrapperRef.current) {
      this.wrapperRef.current.updateState(partial);
    }
  }

  /**
   * Set working state (starts/stops the spinner)
   * When stopping work, captures elapsed/tokens as completion stats
   */
  setWorking(isWorking: boolean, status = ''): void {
    const archivedFinalResponse = isWorking
      ? this.state.finalResponse?.trim()
      : undefined;
    const updates: Partial<AgentUIState> = {
      isWorking,
      status,
      // Clear final response when starting new work
      finalResponse: isWorking ? null : this.state.finalResponse,
      thinking: isWorking ? null : this.state.thinking,
    };

    if (archivedFinalResponse) {
      let lastUserIndex = -1;
      for (let index = this.state.chatMessages.length - 1; index >= 0; index--) {
        if (this.state.chatMessages[index]?.role === 'user') {
          lastUserIndex = index;
          break;
        }
      }
      const alreadyArchived = this.state.chatMessages
        .slice(lastUserIndex + 1)
        .some((message) =>
          message.role === 'assistant' && message.content === archivedFinalResponse
        );
      if (!alreadyArchived) {
        updates.chatMessages = [
          ...this.state.chatMessages,
          { role: 'assistant', content: archivedFinalResponse },
        ];
      }
    }

    // When stopping work, save completion stats from current elapsed/tokens
    if (!isWorking && (this.state.elapsed || this.state.tokens)) {
      updates.completionStats = {
        elapsed: this.state.elapsed || '0s',
        tokens: this.state.tokens || '0 tokens'
      };
    }

    // When starting new work, clear completion stats
    if (isWorking) {
      updates.completionStats = null;
    }

    this.updateState(updates);
  }

  /**
   * Update the status text
   */
  setStatus(status: string): void {
    this.updateState({ status });
  }

  /**
   * Update elapsed time display
   */
  setElapsed(elapsed: string): void {
    this.updateState({ elapsed });
  }

  /**
   * Update token count display
   */
  setTokens(tokens: string): void {
    this.updateState({ tokens });
  }

  /**
   * Add a user message to the conversation display
   */
  addUserMessage(message: string): void {
    this.updateState({
      userMessages: [...this.state.userMessages, message],
      chatMessages: [...this.state.chatMessages, { role: 'user', content: message }],
    });
  }

  addAssistantMessage(message: string): void {
    const content = message.trim();
    if (!content) {
      return;
    }

    this.updateState({
      chatMessages: [...this.state.chatMessages, { role: 'assistant', content }],
    });
  }

  addNotification(message: string): void {
    const content = message.trim();
    if (!content) {
      return;
    }

    this.updateState({
      chatMessages: [...this.state.chatMessages, { role: 'notification', content }],
    });
  }

  setChatMessages(messages: ChatLogMessage[]): void {
    this.updateState({
      chatMessages: messages,
      staticChatMessageOffset: 0,
      userMessages: messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    });
  }

  /**
   * Add a tool output entry
   */
  addToolOutput(tool: string, success: boolean, output: string, thought?: string): void {
    const entry: ToolOutputEntry = {
      id: `tool-${++this.toolIdCounter}`,
      tool,
      success,
      output,
      timestamp: Date.now(),
      thought
    };
    this.updateState({
      toolOutputs: [...this.state.toolOutputs, entry],
      chatMessages: [
        ...this.state.chatMessages,
        { role: 'tool', tool, success, content: output },
      ],
    });
  }

  /**
   * Add multiple tool outputs at once (batched)
   */
  addToolOutputs(outputs: Array<{ tool: string; success: boolean; output: string; thought?: string }>): void {
    const entries: ToolOutputEntry[] = outputs.map((o, i) => ({
      id: `tool-${++this.toolIdCounter}`,
      tool: o.tool,
      success: o.success,
      output: o.output,
      timestamp: Date.now(),
      // Only show thought on first tool (to avoid repetition)
      thought: i === 0 ? o.thought : undefined
    }));
    this.updateState({
      toolOutputs: [...this.state.toolOutputs, ...entries],
      chatMessages: [
        ...this.state.chatMessages,
        ...entries.map((entry) => ({
          role: 'tool' as const,
          tool: entry.tool,
          success: entry.success,
          content: entry.output,
        })),
      ],
    });
  }

  /**
   * Add a grouped batch of parallel tool results, grouped by tool type.
   */
  addToolOutputBatch(
    items: BatchToolItem[],
    thought?: string
  ): void {
    // Group items by tool type
    const groupMap = new Map<string, BatchToolItem[]>();
    for (const item of items) {
      const existing = groupMap.get(item.tool) ?? [];
      existing.push(item);
      groupMap.set(item.tool, existing);
    }

    const groups = Array.from(groupMap.entries()).map(([tool, groupItems]) => ({
      tool,
      items: groupItems
    }));

    const entry: ToolOutputBatchEntry = {
      id: `tool-batch-${++this.toolIdCounter}`,
      type: 'batch' as const,
      thought,
      groups,
      allSuccess: items.every(i => i.success),
      timestamp: Date.now()
    };

    this.updateState({
      toolOutputs: [...this.state.toolOutputs, entry],
      chatMessages: [
        ...this.state.chatMessages,
        {
          role: 'tool',
          tool: 'tools',
          success: entry.allSuccess,
          content: groups.map((group) => {
            const lines = group.items.map((item) =>
              item.detail ? `  ${item.label} - ${item.detail}` : `  ${item.label}`
            );
            return `${group.tool}${group.items.length > 1 ? ` (${group.items.length})` : ''}\n${lines.join('\n')}`;
          }).join('\n'),
        },
      ],
    });
  }

  /**
   * Clear tool outputs
   */
  clearToolOutputs(): void {
    this.updateState({ toolOutputs: [] });
  }

  /**
   * Reset all state and clear the terminal screen.
   * Used by /clear and /new to give a fresh UI without corrupting
   * Ink's log-update state with raw ANSI escape sequences.
   */
  resetAndClearScreen(): void {
    const newState = createInitialUIState();
    this.state = newState;
    if (this.wrapperRef.current) {
      this.wrapperRef.current.updateState(newState);
    }
    if (this.instance) {
      this.instance.clear();
    }
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * Remove a live command from the live commands list without converting it to a static tool output.
   * Used when the caller will handle adding the final output themselves.
   */
  removeLiveCommand(id: string): void {
    this.updateState({
      liveCommands: this.state.liveCommands.filter((item) => item.id !== id)
    });
  }

  startLiveCommand(command: string): string {
    const id = `live-command-${++this.toolIdCounter}`;
    const entry: LiveCommandEntry = {
      id,
      command,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
      isExpanded: false,
    };
    this.updateState({
      liveCommands: [...this.state.liveCommands, entry]
    });
    return id;
  }

  /**
   * Append output to a live command.
   * Output is buffered and flushed periodically to prevent flickering
   * from rapid React state updates during streaming.
   */
  appendLiveCommandOutput(id: string, stream: 'stdout' | 'stderr', chunk: string): void {
    // Accumulate output in a buffer instead of triggering a React update on every chunk.
    // This prevents flickering by batching rapid output into periodic flushes.
    let pending = this.pendingLiveOutput.get(id);
    if (!pending) {
      pending = { stdout: '', stderr: '' };
      this.pendingLiveOutput.set(id, pending);
    }
    if (stream === 'stdout') {
      pending.stdout += stripAnsiCodes(chunk);
    } else {
      pending.stderr += stripAnsiCodes(chunk);
    }

    // Schedule a flush if not already pending
    if (!this.liveOutputFlushTimer) {
      this.liveOutputFlushTimer = setTimeout(
        () => this.flushLiveCommandOutput(),
        InkRenderer.LIVE_OUTPUT_FLUSH_INTERVAL_MS
      );
    }
  }

  /** Flush accumulated live command output buffers to React state */
  private flushLiveCommandOutput(): void {
    this.liveOutputFlushTimer = null;

    if (this.pendingLiveOutput.size === 0) {
      return;
    }

    this.updateState({
      liveCommands: this.state.liveCommands.map((entry) => {
        const pending = this.pendingLiveOutput.get(entry.id);
        if (!pending) {
          return entry;
        }

        return {
          ...entry,
          stdout: entry.stdout + pending.stdout,
          stderr: entry.stderr + pending.stderr,
        };
      })
    });

    // Clear pending buffers
    this.pendingLiveOutput.clear();
  }

  finishLiveCommand(id: string, success: boolean, error?: string): void {
    // Flush any pending output for this command before finalizing
    if (this.pendingLiveOutput.has(id)) {
      // Apply pending output directly to the entry without going through React
      const pending = this.pendingLiveOutput.get(id)!;
      this.state = {
        ...this.state,
        liveCommands: this.state.liveCommands.map((e) => {
          if (e.id !== id) return e;
          return {
            ...e,
            stdout: e.stdout + pending.stdout,
            stderr: e.stderr + pending.stderr,
          };
        })
      };
      this.pendingLiveOutput.delete(id);
    }

    // Cancel any pending flush timer if this was the last pending command
    if (this.pendingLiveOutput.size === 0 && this.liveOutputFlushTimer) {
      clearTimeout(this.liveOutputFlushTimer);
      this.liveOutputFlushTimer = null;
    }

    const entry = this.state.liveCommands.find((item) => item.id === id);
    if (!entry) {
      return;
    }

    const lines = [`$ ${entry.command}`];
    if (entry.stdout.trim()) {
      lines.push(entry.stdout.trimEnd());
    }
    if (entry.stderr.trim()) {
      lines.push(entry.stderr.trimEnd());
    }
    if (!success && error && !lines.includes(error)) {
      lines.push(error);
    }

    const finalizedEntry: ToolOutputEntry = {
      id: `tool-${++this.toolIdCounter}`,
      tool: 'shell',
      success,
      output: lines.join('\n'),
      timestamp: Date.now(),
    };

    this.updateState({
      liveCommands: this.state.liveCommands.filter((item) => item.id !== id),
      toolOutputs: [...this.state.toolOutputs, finalizedEntry],
      chatMessages: [
        ...this.state.chatMessages,
        {
          role: 'tool',
          tool: finalizedEntry.tool,
          success,
          content: finalizedEntry.output,
        },
      ],
    });
  }

  toggleActiveLiveCommandExpanded(): void {
    const active = this.state.liveCommands[this.state.liveCommands.length - 1];
    if (!active) {
      return;
    }

    this.updateState({
      liveCommands: this.state.liveCommands.map((entry) =>
        entry.id === active.id
          ? { ...entry, isExpanded: !entry.isExpanded }
          : entry
      )
    });
  }

  /**
   * Set thinking output
   */
  setThinking(thought: string | null): void {
    this.updateState({ thinking: thought });
  }

  /**
   * Set context percentage (0-100)
   */
  setContextPercent(percent: number): void {
    this.updateState({ contextPercent: percent });
  }

  /**
   * Set provider and model for display in the status line
   */
  setProviderModel(provider: string, model: string): void {
    this.updateState({ provider, model });
  }

  /**
   * Replace all status/help line extension points.
   */
  setLineExtensions(lineExtensions: AgentUILineExtensions | undefined): void {
    this.updateState({ lineExtensions });
  }

  /**
   * Replace only the status-line extension point.
   */
  setStatusLineExtension(status: AgentUILineExtensions['status']): void {
    this.updateState({
      lineExtensions: {
        ...this.state.lineExtensions,
        status,
      },
    });
  }

  /**
   * Replace only the composer help-line extension point.
   */
  setHelpLineExtension(help: AgentUILineExtensions['help']): void {
    this.updateState({
      lineExtensions: {
        ...this.state.lineExtensions,
        help,
      },
    });
  }

  /**
   * Clear the composer input (e.g. after a slash command completes)
   */
  clearInput(): void {
    this.updateState({ currentInput: '' });
  }

  setPendingSuggestion(pendingSuggestion?: Promise<void>): void {
    if (!pendingSuggestion) {
      return;
    }

    pendingSuggestion.then(() => {
      const currentInput = this.wrapperRef.current?.getState().currentInput ?? this.state.currentInput;
      if (currentInput.trim().length > 0 || !this.options.suggestionProvider?.()) {
        return;
      }

      this.updateState({ suggestionRefreshId: Date.now() });
    }).catch(() => {});
  }

  /**
   * Pause input handling by stopping the renderer (preserves state)
   * Use this before external prompts that need stdin access
   */
  pause(): void {
    writeAutohandDebugLine(`[DEBUG] InkRenderer.pause: instance exists=${!!this.instance}`);
    if (this.instance) {
      // Sync state from wrapper before unmounting
      if (this.wrapperRef.current) {
        const currentInput = this.state.currentInput;
        const queuedInstructions = this.state.queuedInstructions;
        this.state = {
          ...this.wrapperRef.current.getState(),
          currentInput,
          queuedInstructions,
        };
      }
      // Ink 7 schedules useInput cleanup through React's passive-effect queue.
      // Callers yield a macrotask after pause() so the modal can attach a fresh
      // readable listener and re-enable raw mode without racing the composer.
      const instance = this.instance;
      try {
        instance.clear();
      } finally {
        instance.unmount();
      }
      this.instance = null;

      // Safety net: ensure stdin is in a clean paused, non-raw state before
      // modal prompts take ownership. Do not remove global listeners here:
      // Ink owns its own cleanup, and other integrations may share stdin.
      safeSetRawMode(process.stdin, false);
    }
  }

  /**
   * Resume input handling by restarting the renderer with preserved state
   */
  async resume(): Promise<void> {
    writeAutohandDebugLine(`[DEBUG] InkRenderer.resume: instance exists=${!!this.instance}`);
    if (!this.instance) {
      // Yield a macrotask so React 19's Scheduler flushes any pending passive
      // effect cleanup from a just-unmounted Ink instance (from pause()).
      // Ink's reconciler uses Scheduler.unstable_scheduleCallback (macrotask) for
      // passive effects, so without this yield the previous instance's useInput
      // cleanup runs AFTER the new instance's useInput effect, calling setRawMode(false)
      // and removing the readable listener we just attached — symptom: composer
      // renders but keyboard is frozen (stdin in cooked/line-buffered mode).
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Ensure stdin is restored to proper state after Modal prompts
      if (process.stdin.isTTY) {
        safeSetRawMode(process.stdin, true);
      }
      // DO NOT call process.stdin.resume() here.
      // After the modal's cleanup, the stream has no 'readable' listener,
      // so resume() would switch it to flowing mode. When the Composer
      // later attaches its own 'readable' listener, Node.js does NOT
      // automatically switch back to paused mode, so the Composer never
      // receives keystrokes.

      // Clear terminal from cursor to end of screen to remove residual
      // dynamic content (thinking, status, input box) from the previous
      // Ink instance. This prevents composer stacking on modal return.
      // \x1b[J = Erase in Display (clear from cursor to end of screen)
      process.stdout.write('\x1b[J');

      // Clear line and move to new line for clean restart
      process.stdout.write('\n');

      // Create fresh ref for new instance
      this.wrapperRef = React.createRef<AgentUIWrapperHandle>();

      // CRITICAL: do not replay already-committed Static history before
      // mounting the new Ink instance.
      //
      // Why: every time we unmount/remount Ink (on every modal cycle), the
      // FRESH Ink instance has no memory of what the PREVIOUS instance
      // committed to scrollback. If we hand it the same full chat array with
      // no offset, it cheerfully re-commits everything below the originals.
      //
      // The original items remain in the terminal's scrollback buffer
      // (committed by the previous Ink instance's onRender). Keep the
      // transcript in state for dedupe/suppression logic, but advance the
      // static offset so only future chat messages are emitted.
      this.state = {
        ...this.state,
        staticChatMessageOffset: this.state.chatMessages.length,
        userMessages: [],
        toolOutputs: [],
      };

      this.instance = render(
        <ThemeProvider>
          <I18nProvider>
            <AgentUIWrapper
              ref={this.wrapperRef}
              initialState={this.state}
              onInstruction={this.options.onInstruction}
              onEscape={this.options.onEscape}
              onCtrlC={this.options.onCtrlC}
              onToggleLiveCommandExpanded={() => this.toggleActiveLiveCommandExpanded()}
              onInputChange={this.handleInputChange}
              enableQueueInput={this.options.enableQueueInput}
              onImageDetected={this.options.onImageDetected}
              filesProvider={this.options.filesProvider}
              slashCommands={this.options.slashCommands}
              skillsProvider={this.options.skillsProvider}
              workspaceRoot={this.options.workspaceRoot}
              suggestionProvider={this.options.suggestionProvider}
              resolveShellSuggestion={this.options.resolveShellSuggestion}
              lineExtensions={this.options.lineExtensions}
            />
          </I18nProvider>
        </ThemeProvider>,
        inkRenderOptions({
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
          // Let AgentUI handle Ctrl+C (clear text / warn-then-exit) instead of Ink forcing exit
          exitOnCtrlC: false
        })
      );
      writeAutohandDebugLine('[DEBUG] InkRenderer.resume: instance created successfully');
    }
  }

  /**
   * Add a queued instruction
   */
  addQueuedInstruction(instruction: string): void {
    const now = Date.now();
    if (
      this.lastQueuedInstruction?.text === instruction &&
      now - this.lastQueuedInstruction.at < InkRenderer.DUPLICATE_INSTRUCTION_SUPPRESSION_MS
    ) {
      return;
    }

    this.lastQueuedInstruction = { text: instruction, at: now };
    this.updateState({
      queuedInstructions: [...this.state.queuedInstructions, instruction]
    });
    // Resolve any pending waiter so the main loop can continue
    if (this._instructionWaiter) {
      const waiter = this._instructionWaiter;
      this._instructionWaiter = null;
      waiter();
    }
  }

  /**
   * Remove and return the next queued instruction
   */
  dequeueInstruction(): string | undefined {
    const [next, ...rest] = this.state.queuedInstructions;
    if (next) {
      this.updateState({ queuedInstructions: rest });
    }
    return next;
  }

  /**
   * Check if there are queued instructions
   */
  hasQueuedInstructions(): boolean {
    return this.state.queuedInstructions.length > 0;
  }

  /**
   * Get the queue count
   */
  getQueueCount(): number {
    return this.state.queuedInstructions.length;
  }

  /**
   * Clear all queued instructions
   */
  clearQueue(): void {
    this.updateState({ queuedInstructions: [] });
  }

  /**
   * Wait for the next instruction to be queued.
   * Returns a promise that resolves as soon as addQueuedInstruction is called.
   * Used by the main loop to await the Ink composer instead of stopping it
   * and falling back to readline (which causes stdin conflicts).
   */
  waitForInstruction(): Promise<void> {
    if (this.state.queuedInstructions.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._instructionWaiter = resolve;
    });
  }

  private _instructionWaiter: (() => void) | null = null;

  /**
   * Set the final response (displayed when not working)
   */
  setFinalResponse(response: string): void {
    const trimmed = response.trim();
    const chatMessages = [...this.state.chatMessages];
    if (trimmed) {
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage?.role !== 'assistant' || lastMessage.content !== trimmed) {
        chatMessages.push({ role: 'assistant', content: trimmed });
      }
    }
    if (this.state.completionStats) {
      const completionContent = `Completed in ${this.state.completionStats.elapsed} · ${this.state.completionStats.tokens}`;
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage?.role !== 'completion' || lastMessage.content !== completionContent) {
        chatMessages.push({ role: 'completion', content: completionContent });
      }
    }

    this.updateState({ finalResponse: response, chatMessages });
  }

  /**
   * Clear all state for a new task
   */
  reset(): void {
    const newState = createInitialUIState();
    this.state = newState;

    // Use React state update if wrapper is mounted
    if (this.wrapperRef.current) {
      this.wrapperRef.current.updateState(newState);
    }
  }

  /**
   * Get current state (for external access)
   */
  getState(): Readonly<AgentUIState> {
    return this.state;
  }

  /**
   * Check if the Ink renderer is currently mounted and running
   */
  isRunning(): boolean {
    return this.instance !== null;
  }
}

/**
 * Create an InkRenderer instance
 */
export function createInkRenderer(options: InkRendererOptions): InkRenderer {
  return new InkRenderer(options);
}
