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
import { disableKittyProtocol, enableKittyProtocol, KITTY_DISAMBIGUATE_FLAG } from '../kittyProtocol.js';
import React, { useState, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { render, type Instance } from 'ink';
import {
  AgentUI,
  createInitialUIState,
  formatCompletionSummary,
  MAX_TOOL_OUTPUT_ENTRIES,
  MAX_VISIBLE_NOTIFICATIONS,
  type ActivityItem,
  type AnnouncementLineState,
  type TipLineState,
  type AgentUILineExtensions,
  type AgentUIState,
  type CommandResultState,
  type ContextTokenDisplay,
} from './AgentUI.js';
import type { GoalEditRequest } from './GoalPanel.js';
import type { LiveCommandEntry, ToolOutputEntry, ToolOutputBatchEntry, ToolOutputItem, BatchToolItem } from './ToolOutput.js';
import type { SlashCommand } from '../../core/slashCommandTypes.js';
import type { ResolvedKeybindings } from '../../keybindings/profiles.js';
import type { SkillMentionInfo } from '../mentionFilter.js';
import type { MessageTarget } from '../messageTargets.js';
import type { ExtensionKeybinding } from '../../extensions/ExtensionRuntimeHost.js';
import { ThemeProvider } from '../theme/ThemeContext.js';
import { getTypedMessageHistory } from '../../session/TypedMessageHistory.js';
import { I18nProvider } from '../i18n/index.js';
import { inkRenderOptions } from '../inkRenderOptions.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { TIP_ROTATION_MS } from '../tips.js';
import { fitsIdleTip, idleTipWidth } from './TipLine.js';
import { safeSetRawMode } from '../rawMode.js';
import type { ChatLogMessage } from '../../session/chatLog.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';
import {
  serializeWorkspaceChangeSet,
  type WorkspaceChangeSet,
} from '../../core/agent/WorkspaceChangeCapture.js';
import type { InteractionMode } from '../../core/agent/InteractionModeController.js';
import type { TeamActivitySnapshot } from '../../core/teams/types.js';
import type { AgentRunsSnapshot, AgentRunSource } from '../../core/agents/AgentRunStore.js';
import type { GoalSessionSnapshot } from '../../goals/types.js';
import type { TaskListPosition } from '../../types.js';
import type { PeerDescriptor, PeerReceipt, PeerScope } from '../../session/peers/PeerProtocol.js';
import type { PeerComposerDraft, PeerInstructionMetadata, PeerReference } from '../peerMention.js';
import type { LineExtension, LineSegment } from './StatusLine.js';
import {
  createSequencedQueuedWork,
  type SequencedQueuedWork,
} from '../../utils/queuedWorkSequence.js';

export interface InkRendererOptions {
  onSteer?: (text: string) => void;
  onSteerQueuedMessage?: (text: string) => boolean;
  onWorkingSpinnerFrame?: (frame: number) => void;
  onInstruction: (text: string, metadata?: PeerInstructionMetadata) => void;
  peerScopes?: PeerScope[];
  peersProvider?: (scope?: PeerScope) => PeerDescriptor[];
  onPeersRefresh?: (scope?: PeerScope) => Promise<unknown>;
  onPeerMessage?: (input: { to: string; content: string; replyTo?: string }) => Promise<PeerReceipt>;
  onEscape: () => void;
  onCtrlC: () => void;
  onDismissAnnouncement?: (id: string) => void;
  enableQueueInput?: boolean;
  /** Called when a dragged/dropped image is detected in the input */
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  /** Provider for file list used in @ mention autocomplete */
  filesProvider?: () => string[];
  /** Slash commands for / autocomplete */
  slashCommands?: SlashCommand[];
  /** Provider for skill list used in $ mention autocomplete */
  skillsProvider?: () => SkillMentionInfo[];
  messageTargetsProvider?: () => MessageTarget[];
  /** Base path used for shell path completion. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Lazy provider for the current next-step suggestion shown as ghost text. */
  suggestionProvider?: () => string | undefined;
  /** Optional async LLM resolver for ! command suggestions. */
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  /** Optional extension points for status/help lines. */
  lineExtensions?: AgentUILineExtensions;
  extensionKeybindings?: ExtensionKeybinding[];
  runtimeLineExtensions?: AgentUILineExtensions;
  getInteractionMode?: () => InteractionMode;
  onCycleInteractionMode?: () => InteractionMode;
  mouseComposerCursor?: boolean;
  keybindings?: ResolvedKeybindings;
  taskListPositionProvider?: () => TaskListPosition;
  onEditGoalObjective?: (request: GoalEditRequest) => void | Promise<void>;
  onCancelAgentRun?: (id: string) => void | Promise<unknown>;
  onMessageAgentRun?: (id: string, text: string) => Promise<boolean>;
  /** Draws the next tip `accept` allows; tips rotate beside the composer while no turn runs. */
  tipProvider?: (accept: (tip: string) => boolean) => string | undefined;
}

export interface SetWorkingOptions {
  succeeded?: boolean;
}

const MAX_LIVE_OUTPUT_CHARS = 256 * 1024;
const MAX_COMPLETED_LIVE_OUTPUT_CHARS = 64 * 1024;
const MAX_COMPLETED_COMMAND_CHARS = 4 * 1024;
const LIVE_OUTPUT_TRUNCATION_MARKER = '[earlier live output truncated]';

function appendBoundedLiveOutput(current: string, addition: string): string {
  const combined = current + addition;
  if (combined.length <= MAX_LIVE_OUTPUT_CHARS) {
    return combined;
  }

  const suffixLength = MAX_LIVE_OUTPUT_CHARS - LIVE_OUTPUT_TRUNCATION_MARKER.length - 1;
  return `${LIVE_OUTPUT_TRUNCATION_MARKER}\n${combined.slice(-suffixLength)}`;
}

function completedOutputTail(output: string, maxChars: number): string {
  const normalized = output.trimEnd();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const prefix = `${LIVE_OUTPUT_TRUNCATION_MARKER}\n`;
  if (maxChars <= prefix.length) {
    return normalized.slice(-maxChars);
  }
  return `${prefix}${normalized.slice(-(maxChars - prefix.length))}`;
}

function formatCompletedLiveOutput(
  command: string,
  sections: string[],
): string {
  const rawHeader = `$ ${command}`;
  const header = rawHeader.length <= MAX_COMPLETED_COMMAND_CHARS
    ? rawHeader
    : `${rawHeader.slice(0, MAX_COMPLETED_COMMAND_CHARS - 1)}…`;
  const nonEmptySections = sections.filter((section) => section.trim().length > 0);
  if (nonEmptySections.length === 0) {
    return header;
  }

  const separatorChars = nonEmptySections.length;
  const availableChars = MAX_COMPLETED_LIVE_OUTPUT_CHARS - header.length - separatorChars;
  const sectionBudget = Math.max(1, Math.floor(availableChars / nonEmptySections.length));
  return [
    header,
    ...nonEmptySections.map((section) => completedOutputTail(section, sectionBudget)),
  ].join('\n');
}

function stringArraysEqual(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function lineSegmentsEqual(left: LineSegment[] = [], right: LineSegment[] = []): boolean {
  return left.length === right.length && left.every((segment, index) => {
    const other = right[index];
    return other !== undefined
      && segment.id === other.id
      && segment.text === other.text
      && segment.color === other.color
      && segment.visible === other.visible;
  });
}

function lineExtensionsEqual(left?: LineExtension, right?: LineExtension): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.replaceDefault === right.replaceDefault
    && left.separator === right.separator
    && stringArraysEqual(left.hiddenDefaultSegmentIds, right.hiddenDefaultSegmentIds)
    && lineSegmentsEqual(left.segments, right.segments);
}

function agentUILineExtensionsEqual(
  left?: AgentUILineExtensions,
  right?: AgentUILineExtensions,
): boolean {
  return left === right
    || Boolean(left && right
      && lineExtensionsEqual(left.status, right.status)
      && lineExtensionsEqual(left.help, right.help));
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
  onSteer?: (text: string) => void;
  onSteerQueuedInstruction: (index: number, sequence: number | undefined, originalText: string, text: string) => boolean;
  onWorkingSpinnerFrame?: (frame: number) => void;
  onInstruction: InkRendererOptions['onInstruction'];
  peerScopes?: InkRendererOptions['peerScopes'];
  peersProvider?: InkRendererOptions['peersProvider'];
  onPeersRefresh?: InkRendererOptions['onPeersRefresh'];
  onPeerMessage?: InkRendererOptions['onPeerMessage'];
  onEscape: () => void;
  onCtrlC: () => void;
  onDismissAnnouncement?: (id: string) => void;
  onToggleLiveCommandExpanded: (id?: string) => void;
  onToggleTeamPanel: () => void;
  onCloseAgentRunsPanel: () => void;
  onCancelAgentRun?: (id: string) => void | Promise<unknown>;
  onMessageAgentRun?: (id: string, text: string) => Promise<boolean>;
  onToggleGoalPanel: () => void;
  onEditGoalObjective?: (request: GoalEditRequest) => void | Promise<void>;
  onInputChange: (input: string, metadata?: PeerInstructionMetadata) => void;
  enableQueueInput?: boolean;
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  filesProvider?: () => string[];
  slashCommands?: SlashCommand[];
  skillsProvider?: () => SkillMentionInfo[];
  messageTargetsProvider?: () => MessageTarget[];
  workspaceRoot?: string;
  suggestionProvider?: () => string | undefined;
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  lineExtensions?: AgentUILineExtensions;
  extensionKeybindings?: ExtensionKeybinding[];
  onReplaceQueuedInstruction: (index: number, text: string, metadata?: PeerInstructionMetadata) => void;
  onRemoveQueuedInstruction: (index: number) => void;
  getInteractionMode?: () => InteractionMode;
  onCycleInteractionMode?: () => InteractionMode;
  mouseComposerCursor?: boolean;
  keybindings?: ResolvedKeybindings;
  taskListPositionProvider?: () => TaskListPosition;
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
      onSteer,
      onSteerQueuedInstruction,
      onWorkingSpinnerFrame,
      onEscape,
      onCtrlC,
      onDismissAnnouncement,
      onToggleLiveCommandExpanded,
      onToggleTeamPanel,
      onCloseAgentRunsPanel,
      onCancelAgentRun,
      onMessageAgentRun,
      onToggleGoalPanel,
      onEditGoalObjective,
      onInputChange,
      enableQueueInput,
      onImageDetected,
      filesProvider,
      slashCommands,
      skillsProvider,
      messageTargetsProvider,
      peerScopes,
  peersProvider,
      onPeersRefresh,
      onPeerMessage,
      workspaceRoot,
      suggestionProvider,
      resolveShellSuggestion,
      lineExtensions,
      extensionKeybindings,
      onReplaceQueuedInstruction,
      onRemoveQueuedInstruction,
      getInteractionMode,
      onCycleInteractionMode,
      mouseComposerCursor,
      keybindings,
      taskListPositionProvider,
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
    const handleInputChange = useCallback((input: string, metadata?: PeerInstructionMetadata) => {
      setState(prev => ({ ...prev, currentInput: input, peerInputMetadata: metadata, peerDraft: undefined }));
      onInputChange(input, metadata);
    }, [onInputChange]);

    return (
      <AgentUI
        state={state}
        typedMessageHistory={getTypedMessageHistory()}
        onInstruction={onInstruction}
        onSteer={onSteer}
        onSteerQueuedInstruction={onSteerQueuedInstruction}
        onWorkingSpinnerFrame={onWorkingSpinnerFrame}
        onEscape={onEscape}
        onCtrlC={onCtrlC}
        onDismissAnnouncement={onDismissAnnouncement}
        onToggleLiveCommandExpanded={onToggleLiveCommandExpanded}
        onToggleTeamPanel={onToggleTeamPanel}
        onCloseAgentRunsPanel={onCloseAgentRunsPanel}
        onCancelAgentRun={onCancelAgentRun}
        onMessageAgentRun={onMessageAgentRun}
        onToggleGoalPanel={onToggleGoalPanel}
        onEditGoalObjective={onEditGoalObjective}
        onInputChange={handleInputChange}
        enableQueueInput={enableQueueInput}
        onImageDetected={onImageDetected}
        filesProvider={filesProvider}
        slashCommands={slashCommands}
        skillsProvider={skillsProvider}
        messageTargetsProvider={messageTargetsProvider}
        peerScopes={peerScopes}
        peersProvider={peersProvider}
        onPeersRefresh={onPeersRefresh}
        onPeerMessage={onPeerMessage}
        workspaceRoot={workspaceRoot}
        suggestionProvider={suggestionProvider}
        resolveShellSuggestion={resolveShellSuggestion}
        lineExtensions={lineExtensions}
        extensionKeybindings={extensionKeybindings}
        onReplaceQueuedInstruction={onReplaceQueuedInstruction}
        onRemoveQueuedInstruction={onRemoveQueuedInstruction}
        getInteractionMode={getInteractionMode}
        onCycleInteractionMode={onCycleInteractionMode}
        mouseComposerCursor={mouseComposerCursor}
        keybindings={keybindings}
        taskListPosition={taskListPositionProvider?.() ?? 'above-composer'}
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
  private notificationContentsByKey = new Map<string, string>();
  /** Pending live command output buffers (accumulated between flushes) */
  private pendingLiveOutput = new Map<string, { stdout: string; stderr: string }>();
  /** Timer for throttling live command output flushes */
  /** Set when the elapsed or token counters move; cleared once a summary row reports them. */
  private countersChangedSinceSummary = false;
  private liveOutputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Flush interval in ms - batches rapid output to prevent flickering */
  private static readonly LIVE_OUTPUT_FLUSH_INTERVAL_MS = 100;

  private static readonly DUPLICATE_INSTRUCTION_SUPPRESSION_MS = 1000;

  /** Resize handler reference for cleanup */
  private resizeHandler: (() => void) | null = null;

  /** Debounce timer for drag-resize events */
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Rotates tips beside the composer while no turn runs. */
  private idleTipTimer: ReturnType<typeof setInterval> | null = null;

  /** Debounce time for resize events (ms) - longer to batch drag-resize */
  private static readonly RESIZE_DEBOUNCE_MS = 150;

  /** Cleanup function for stdout sync-output patch */
  private unpatchedStdout: (() => void) | null = null;

  private lastQueuedInstruction: { text: string; at: number } | null = null;
  private queuedInstructionEntries: Array<SequencedQueuedWork & Partial<PeerInstructionMetadata>> = [];

  constructor(options: InkRendererOptions) {
    this.options = options;
    this.state = {
      ...createInitialUIState(),
      lineExtensions: options.lineExtensions,
      extensionKeybindings: options.extensionKeybindings,
      extensionLineExtensions: options.runtimeLineExtensions,
      interactionMode: options.getInteractionMode?.() ?? 'default',
    };
    this.wrapperRef = React.createRef<AgentUIWrapperHandle>();
  }

  /**
   * Handle input changes from AgentUI to preserve across pause/resume
   */
  private handleInputChange = (input: string, metadata?: PeerInstructionMetadata): void => {
    this.state = { ...this.state, currentInput: input, peerInputMetadata: metadata, peerDraft: undefined };
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

    // Shift+Enter, Alt+Enter and Esc are only distinguishable when the
    // terminal encodes modified keys. Ink parses the kitty CSI u form; iTerm2,
    // Ghostty, kitty and WezTerm honour the request, others ignore it.
    if (process.stdout.isTTY) {
      enableKittyProtocol(process.stdout, KITTY_DISAMBIGUATE_FLAG);
    }

    // Install our resize guard BEFORE Ink registers its own handler.
    // Node.js event listeners fire in registration order.
    this.resizeHandler = this.onResize;
    if (typeof process.stdout.on === 'function') {
      process.stdout.on('resize', this.resizeHandler);
    }

    // Seed the idle tip before the first frame so it does not pop in a render later.
    this.syncIdleTips();

    this.instance = this.mountAgentUI();
  }

  /**
   * Render a fresh Ink instance for the agent UI from the current state.
   * Shared by the initial start() and by resume() after a modal.
   */
  private mountAgentUI(): Instance {
    return render(
      <ThemeProvider>
        <I18nProvider>
          <AgentUIWrapper
            ref={this.wrapperRef}
            initialState={this.state}
            onInstruction={this.options.onInstruction}
            onSteer={this.options.onSteer}
            onSteerQueuedInstruction={(index, sequence, originalText, text) => this.steerQueuedInstruction(index, sequence, originalText, text)}
            onWorkingSpinnerFrame={this.options.onWorkingSpinnerFrame}
            onEscape={this.options.onEscape}
            onCtrlC={this.options.onCtrlC}
            onDismissAnnouncement={this.options.onDismissAnnouncement}
            onToggleLiveCommandExpanded={(id) => this.toggleActiveLiveCommandExpanded(id)}
            onToggleTeamPanel={() => this.toggleTeamPanel()}
            onCloseAgentRunsPanel={() => this.setAgentRunsPanelVisible(false)}
            onCancelAgentRun={this.options.onCancelAgentRun}
            onMessageAgentRun={this.options.onMessageAgentRun}
            onToggleGoalPanel={() => this.toggleGoalPanel()}
            onEditGoalObjective={this.options.onEditGoalObjective}
            onInputChange={this.handleInputChange}
            enableQueueInput={this.options.enableQueueInput}
            onImageDetected={this.options.onImageDetected}
            filesProvider={this.options.filesProvider}
            slashCommands={this.options.slashCommands}
            skillsProvider={this.options.skillsProvider}
            messageTargetsProvider={this.options.messageTargetsProvider}
            peerScopes={this.options.peerScopes}
            peersProvider={this.options.peersProvider}
            onPeersRefresh={this.options.onPeersRefresh}
            onPeerMessage={this.options.onPeerMessage}
            workspaceRoot={this.options.workspaceRoot}
            suggestionProvider={this.options.suggestionProvider}
            resolveShellSuggestion={this.options.resolveShellSuggestion}
            lineExtensions={this.options.lineExtensions}
            extensionKeybindings={this.options.extensionKeybindings}
            onReplaceQueuedInstruction={(index, text, metadata) => this.replaceQueuedInstruction(index, text, metadata)}
            onRemoveQueuedInstruction={(index) => this.removeQueuedInstruction(index)}
            getInteractionMode={this.options.getInteractionMode}
            onCycleInteractionMode={this.options.onCycleInteractionMode}
            mouseComposerCursor={this.options.mouseComposerCursor}
            keybindings={this.options.keybindings}
            taskListPositionProvider={this.options.taskListPositionProvider}
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
  async stop(): Promise<void> {
    let waitForExit: Promise<void> | undefined;
    if (this.instance && process.stdout.isTTY) {
      disableKittyProtocol(process.stdout);
    }
    if (this.instance) {
      const instance = this.instance;
      try {
        instance.clear();
      } finally {
        instance.unmount();
      }
      this.instance = null;
      try {
        waitForExit = Promise.resolve(instance.waitUntilExit()).then(() => undefined);
      } catch {
        waitForExit = Promise.resolve();
      }
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

    this.stopIdleTips();
    if (this.liveOutputFlushTimer) {
      clearTimeout(this.liveOutputFlushTimer);
      this.liveOutputFlushTimer = null;
    }
    this.pendingLiveOutput.clear();

    if (this.unpatchedStdout) {
      this.unpatchedStdout();
      this.unpatchedStdout = null;
    }

    // Clear any pending instruction waiter to prevent dangling promises
    this._instructionWaiter = null;

    await waitForExit?.catch(() => undefined);
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

  private archiveCompletedTurnMessages(
    messages: ChatLogMessage[],
    finalResponse: string | undefined,
    completionStats: AgentUIState['completionStats'],
    thinking: string | null = null,
  ): ChatLogMessage[] {
    let nextMessages = messages;

    if (finalResponse) {
      const alreadyArchived = nextMessages
        .some((message) =>
          message.role === 'assistant' && message.content === finalResponse
        );
      if (!alreadyArchived) {
        // The thought is only set when show-thinking is on; keep it ahead of
        // the reply it belongs to so the transcript reads in order.
        const thought = thinking?.trim();
        nextMessages = [
          ...nextMessages,
          ...(thought ? [{ role: 'thinking' as const, content: thought }] : []),
          { role: 'assistant', content: finalResponse },
        ];
      }
    }

    if (completionStats) {
      const content = formatCompletionSummary(completionStats);
      const alreadyArchived = nextMessages
        .some((message) =>
          message.role === 'completion' && message.content === content
        );
      if (!alreadyArchived) {
        nextMessages = [
          ...nextMessages,
          { role: 'completion', content },
        ];
      }
    }

    return nextMessages;
  }

  /**
   * Set working state (starts/stops the spinner)
   * When stopping work, captures elapsed/tokens as completion stats
   */
  setWorking(isWorking: boolean, status = '', options: SetWorkingOptions = {}): void {
    const archivedFinalResponse = isWorking
      ? this.state.finalResponse?.trim()
      : undefined;
    const updates: Partial<AgentUIState> = {
      isWorking,
      status,
      // Clear final response when starting new work
      finalResponse: isWorking ? null : this.state.finalResponse,
      streamingResponse: null,
      thinking: isWorking ? null : this.state.thinking,
    };

    if (isWorking) {
      const archivedMessages = this.archiveCompletedTurnMessages(
        this.state.chatMessages,
        archivedFinalResponse,
        this.state.completionStats,
        this.state.thinking,
      );
      if (archivedMessages !== this.state.chatMessages) {
        updates.chatMessages = archivedMessages;
      }
    } else {
      Object.assign(updates, this.archiveIdleReply(this.state.chatMessages, this.state.finalResponse, this.state.thinking));
    }

    // When stopping work, save completion stats from current elapsed/tokens.
    // Only a turn that actually ran gets a summary: an idle transition after a
    // slash command would otherwise reuse the previous turn's counters and
    // label them "Completed" even when that turn failed.
    const turnEnded = options.succeeded !== undefined || this.countersChangedSinceSummary;
    if (!isWorking && turnEnded && (this.state.elapsed || this.state.tokens)) {
      const completionStatus = options.succeeded === false
        ? 'failed'
        : this.state.completionStats?.status;
      updates.completionStats = {
        elapsed: this.state.elapsed || '0s',
        tokens: this.state.tokens || '0 tokens',
        ...(completionStatus ? { status: completionStatus } : {})
      };
      this.countersChangedSinceSummary = false;
    }

    // When starting new work, clear completion stats
    if (isWorking) {
      updates.completionStats = null;
      updates.commandResult = undefined;
    }

    // Tips rotate only while idle; an upgrade hint stays until the next turn starts.
    if (isWorking && this.state.tip) {
      updates.tip = undefined;
    }

    this.updateState(updates);
    this.syncIdleTips();
  }

  /**
   * Update the status text
   */
  setStatus(status: string): void {
    this.updateState({ status });
  }

  setInteractionMode(interactionMode: InteractionMode): void {
    this.updateState({ interactionMode });
  }

  /**
   * Update elapsed time display
   */
  setElapsed(elapsed: string): void {
    this.countersChangedSinceSummary = true;
    this.updateState({ elapsed });
  }

  /**
   * Update token count display
   */
  setTokens(tokens: string): void {
    this.countersChangedSinceSummary = true;
    this.updateState({ tokens });
  }

  /**
   * Add a user message to the conversation display
   */
  addUserMessage(message: string): void {
    const archivedMessages = this.archiveCompletedTurnMessages(
      this.state.chatMessages,
      this.state.finalResponse?.trim() || undefined,
      this.state.completionStats,
      this.state.thinking,
    );

    this.updateState({
      userMessages: [...this.state.userMessages, message],
      chatMessages: [...archivedMessages, { role: 'user', content: message }],
      finalResponse: this.state.finalResponse ? null : this.state.finalResponse,
      thinking: this.state.thinking ? null : this.state.thinking,
      completionStats: this.state.completionStats ? null : this.state.completionStats,
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

  /**
   * Keep high-frequency operational command results adjacent to the status
   * line, rather than growing the transcript above the composer.
   */
  setCommandResult(command: string, output: string): void {
    const content = output.trim();
    if (!content) {
      return;
    }
    const commandResult: CommandResultState = { command, output: content };
    this.updateState({ commandResult });
  }

  addNotification(message: string): void {
    const content = message.trim();
    if (!content) {
      return;
    }

    this.updateState({
      notifications: this.appendNotifications(content),
    });
  }

  /** Only the newest notifications are ever drawn, so older ones are released immediately. */
  private appendNotifications(content: string): string[] {
    return [...this.state.notifications, content].slice(-MAX_VISIBLE_NOTIFICATIONS);
  }

  /** Only the newest tool outputs are ever drawn, so older ones are released immediately. */
  private appendToolOutputs(...entries: ToolOutputItem[]): ToolOutputItem[] {
    return [...this.state.toolOutputs, ...entries].slice(-MAX_TOOL_OUTPUT_ENTRIES);
  }

  upsertNotification(key: string, message: string): void {
    const content = message.trim();
    if (!content) {
      return;
    }

    const previousContent = this.notificationContentsByKey.get(key);
    if (previousContent === content) {
      return;
    }

    const previousIndex = previousContent === undefined
      ? -1
      : this.state.notifications.lastIndexOf(previousContent);
    const notifications = previousIndex === -1
      ? this.appendNotifications(content)
      : this.state.notifications.map((notification, index) =>
        index === previousIndex ? content : notification,
      );

    this.notificationContentsByKey.set(key, content);
    this.updateState({ notifications });
  }

  setChatMessages(messages: ChatLogMessage[]): void {
    this.updateState({
      chatMessages: messages,
      staticChatMessageOffset: 0,
      chatHistoryEpoch: this.state.chatHistoryEpoch + 1,
      userMessages: messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    });
  }

  addToolCall(tool: string, detail: string): void {
    this.updateState({
      chatMessages: [
        ...this.state.chatMessages,
        { role: 'tool_call', tool, content: detail.trim() },
      ],
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
      toolOutputs: this.appendToolOutputs(entry),
      chatMessages: [
        ...this.state.chatMessages,
        { role: 'tool', tool, success, content: output },
      ],
    });
  }

  addWorkspaceChanges(changeSet: WorkspaceChangeSet): void {
    this.addToolOutput('workspace_changes', true, serializeWorkspaceChangeSet(changeSet));
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
      toolOutputs: this.appendToolOutputs(...entries),
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
      toolOutputs: this.appendToolOutputs(entry),
      chatMessages: [
        ...this.state.chatMessages,
        {
          role: 'tool_batch',
          tool: groups.length === 1 ? groups[0]!.tool : 'tools',
          success: entry.allSuccess,
          content: '',
          groups,
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
    const newState = {
      ...createInitialUIState(),
      interactionMode: this.options.getInteractionMode?.() ?? this.state.interactionMode,
      announcement: this.state.announcement,
    };
    this.queuedInstructionEntries = [];
    this.notificationContentsByKey.clear();
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
      pending.stdout = appendBoundedLiveOutput(pending.stdout, stripAnsiCodes(chunk));
    } else {
      pending.stderr = appendBoundedLiveOutput(pending.stderr, stripAnsiCodes(chunk));
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
    if (this.liveOutputFlushTimer) {
      clearTimeout(this.liveOutputFlushTimer);
    }
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
          stdout: appendBoundedLiveOutput(entry.stdout, pending.stdout),
          stderr: appendBoundedLiveOutput(entry.stderr, pending.stderr),
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
            stdout: appendBoundedLiveOutput(e.stdout, pending.stdout),
            stderr: appendBoundedLiveOutput(e.stderr, pending.stderr),
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

    const sections: string[] = [];
    if (entry.stdout.trim()) {
      sections.push(entry.stdout);
    }
    if (entry.stderr.trim()) {
      sections.push(entry.stderr);
    }
    if (!success && error && !sections.includes(error)) {
      sections.push(error);
    }

    const finalizedEntry: ToolOutputEntry = {
      id: `tool-${++this.toolIdCounter}`,
      tool: 'shell',
      success,
      output: formatCompletedLiveOutput(entry.command, sections),
      timestamp: Date.now(),
    };

    this.updateState({
      liveCommands: this.state.liveCommands.filter((item) => item.id !== id),
      toolOutputs: this.appendToolOutputs(finalizedEntry),
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

  toggleActiveLiveCommandExpanded(commandId?: string): void {
    let active = commandId
      ? this.state.liveCommands.find((entry) => entry.id === commandId)
      : this.state.liveCommands[this.state.liveCommands.length - 1];
    if (!active) {
      return;
    }

    if (this.pendingLiveOutput.has(active.id)) {
      this.flushLiveCommandOutput();
      active = commandId
        ? this.state.liveCommands.find((entry) => entry.id === commandId)
        : this.state.liveCommands[this.state.liveCommands.length - 1];
      if (!active) {
        return;
      }
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
   * Set current context token usage and total context window.
   */
  setContextTokens(contextTokens: ContextTokenDisplay | undefined): void {
    this.updateState({ contextTokens });
  }

  /**
   * Set provider and model for display in the status line
   */
  setProviderModel(provider: string, model: string): void {
    this.updateState({ provider, model });
  }

  setPlanLabel(planLabel: string | undefined): void {
    this.updateState({ planLabel });
  }

  setAnnouncement(announcement: AnnouncementLineState | undefined): void {
    this.updateState({ announcement });
  }

  setTip(tip: TipLineState | undefined): void {
    this.updateState({ tip });
  }

  private syncIdleTips(): void {
    if (this.state.isWorking) {
      this.stopIdleTips();
      return;
    }
    if (this.idleTipTimer || !this.options.tipProvider) {
      return;
    }
    this.showNextIdleTip();
    this.idleTipTimer = setInterval(() => this.showNextIdleTip(), TIP_ROTATION_MS);
    this.idleTipTimer.unref?.();
  }

  private stopIdleTips(): void {
    if (this.idleTipTimer) {
      clearInterval(this.idleTipTimer);
      this.idleTipTimer = null;
    }
  }

  /** Draws a tip that fits the room left beside the completion summary; a pinned upgrade hint wins. */
  private showNextIdleTip(): void {
    if (this.state.isWorking || this.state.tip?.kind === 'upgrade') {
      return;
    }
    const stats = this.state.completionStats;
    const width = idleTipWidth(process.stdout.columns ?? 80, stats ? formatCompletionSummary(stats) : undefined);
    const text = this.options.tipProvider?.((tip) => fitsIdleTip(tip, width));
    this.updateState({ tip: text ? { kind: 'tip', text } : undefined });
  }

  /**
   * Replace todo-kind activity items while preserving active sub-agent rows.
   */
  setTodoActivityItems(todos: ActivityItem[]): void {
    const existing = this.state.activityItems ?? [];
    const subagents = existing.filter((item) => item.kind === 'subagent');
    this.updateState({
      activityItems: [...todos.filter((item) => item.kind === 'todo'), ...subagents],
    });
  }

  /**
   * Upsert a single activity row (used for sub-agent start/stop lifecycle).
   */
  upsertActivityItem(item: ActivityItem): void {
    const existing = this.state.activityItems ?? [];
    const index = existing.findIndex((entry) => entry.id === item.id);
    if (index === -1) {
      this.updateState({ activityItems: [...existing, item] });
      return;
    }
    const next = existing.slice();
    next[index] = { ...existing[index], ...item };
    this.updateState({ activityItems: next });
  }

  /** Clear all sticky activity rows (new turn / /new). */
  clearActivityItems(): void {
    this.updateState({ activityItems: [] });
  }

  setTeamActivity(teamActivity: TeamActivitySnapshot): void {
    this.updateState({ teamActivity });
  }

  setAgentRuns(agentRuns: AgentRunsSnapshot): void {
    this.updateState({ agentRuns });
  }

  setAgentRunsPanelVisible(visible: boolean, source?: AgentRunSource): void {
    this.updateState({ agentRunsPanelVisible: visible, agentRunsSource: source });
  }

  setTeamPanelVisible(visible: boolean): void {
    this.updateState({ teamPanelVisible: visible });
  }

  toggleTeamPanel(): void {
    this.setTeamPanelVisible(!this.state.teamPanelVisible);
  }

  setGoalActivity(goalActivity: GoalSessionSnapshot): void {
    this.updateState({ goalActivity });
  }

  setGoalPanelVisible(visible: boolean): void {
    this.updateState({ goalPanelVisible: visible });
  }

  toggleGoalPanel(): void {
    this.setGoalPanelVisible(!this.state.goalPanelVisible);
  }

  /**
   * Replace all status/help line extension points.
   */
  setLineExtensions(lineExtensions: AgentUILineExtensions | undefined): void {
    this.updateState({ lineExtensions });
  }

  /**
   * Replace built-in configured status/help line fields without overwriting
   * extension-provided line extensions.
   */
  setConfiguredLineExtensions(configuredLineExtensions: AgentUILineExtensions | undefined): void {
    if (agentUILineExtensionsEqual(this.state.configuredLineExtensions, configuredLineExtensions)) {
      return;
    }
    this.updateState({ configuredLineExtensions });
  }

  setShowModeLabel(showModeLabel: boolean): void {
    if (this.state.showModeLabel === showModeLabel) {
      return;
    }
    this.updateState({ showModeLabel });
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

  setRuntimeSlashCommands(commands: SlashCommand[]): void {
    this.updateState({ runtimeSlashCommands: [...commands] });
  }

  setExtensionKeybindings(keybindings: ExtensionKeybinding[]): void {
    this.updateState({ extensionKeybindings: [...keybindings] });
  }

  setRuntimeLineExtensions(lineExtensions: AgentUILineExtensions | undefined): void {
    this.updateState({ extensionLineExtensions: lineExtensions });
  }

  /**
   * Clear the composer input (e.g. after a slash command completes)
   */
  clearInput(): void {
    this.updateState({ currentInput: '', peerDraft: undefined, peerInputMetadata: undefined });
  }

  setInput(text: string): void {
    this.updateState({ currentInput: text, peerDraft: undefined, peerInputMetadata: undefined });
  }

  setPeerDraft(draft: PeerComposerDraft): void {
    this.updateState({
      currentInput: draft.text ?? `:${draft.reference.alias} `,
      peerDraft: structuredClone(draft),
      peerInputMetadata: {
        peerReferences: [structuredClone(draft.reference)],
        peerScope: draft.scope ?? this.state.peerInputMetadata?.peerScope ?? 'workspace',
        ...(draft.replyTo ? { peerReplyTo: draft.replyTo } : {}),
      },
    });
  }

  refreshPeers(): void {
    this.updateState({ peerDirectoryVersion: (this.state.peerDirectoryVersion ?? 0) + 1 });
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
        const queuedInstructionSequences = this.state.queuedInstructionSequences;
        const queuedInstructionMetadata = this.state.queuedInstructionMetadata;
        this.state = {
          ...this.wrapperRef.current.getState(),
          currentInput,
          queuedInstructions,
          queuedInstructionSequences,
          queuedInstructionMetadata,
        };
      }
      // Ink 7 schedules useInput cleanup through React's passive-effect queue.
      // Callers yield a macrotask after pause() so the modal can attach a fresh
      // readable listener and re-enable raw mode without racing the composer.
      // Clear the live composer frame before unmounting so it does not remain
      // above the fresh composer after the modal closes. resume() replays the
      // canonical chat transcript instead of relying on this frame's pixels.
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
      this.lastQueuedInstruction = null;

      // Unmounting the previous Ink instance removes its visible primary-screen
      // frame before the alternate-screen modal opens. Replay the canonical
      // chatMessages state when remounting so modal commands never erase the
      // user's transcript. Legacy arrays stay empty to avoid rendering their
      // entries alongside the canonical chat history.
      this.state = {
        ...this.state,
        staticChatMessageOffset: 0,
        userMessages: [],
        toolOutputs: [],
        notifications: [],
      };

      this.instance = this.mountAgentUI();
      writeAutohandDebugLine('[DEBUG] InkRenderer.resume: instance created successfully');
    }
  }

  /**
   * Add a queued instruction
   */
  addQueuedInstruction(instruction: string, metadata?: PeerInstructionMetadata): void {
    const now = Date.now();
    if (
      this.lastQueuedInstruction?.text === instruction &&
      now - this.lastQueuedInstruction.at < InkRenderer.DUPLICATE_INSTRUCTION_SUPPRESSION_MS
    ) {
      return;
    }

    this.lastQueuedInstruction = { text: instruction, at: now };
    this.queuedInstructionEntries.push({ ...createSequencedQueuedWork(instruction), ...(metadata?.peerReferences.length ? structuredClone(metadata) : {}) });
    this.updateState({
      queuedInstructions: [...this.state.queuedInstructions, instruction],
      queuedInstructionSequences: this.queueSequences(),
      queuedInstructionMetadata: this.queueMetadata()
    });
    // Resolve any pending waiter so the main loop can continue
    if (this._instructionWaiter) {
      const waiter = this._instructionWaiter;
      this._instructionWaiter = null;
      waiter();
    }
  }

  /**
   * Replace an existing queued instruction while preserving queue order.
   */
  replaceQueuedInstruction(index: number, instruction: string, metadata?: PeerInstructionMetadata): boolean {
    if (index < 0 || index >= this.state.queuedInstructions.length) {
      return false;
    }

    const queuedInstructions = [...this.state.queuedInstructions];
    queuedInstructions[index] = instruction;
    const queuedEntry = this.queuedInstructionEntries[index];
    if (queuedEntry) {
      this.queuedInstructionEntries[index] = {
        sequence: queuedEntry.sequence,
        text: instruction,
        ...(metadata?.peerReferences.length ? structuredClone(metadata) : {}),
      };
    }
    this.updateState({ queuedInstructions, queuedInstructionSequences: this.queueSequences(), queuedInstructionMetadata: this.queueMetadata() });
    return true;
  }

  /**
   * Remove an existing queued instruction while preserving FIFO order.
   */
  removeQueuedInstruction(index: number): boolean {
    if (index < 0 || index >= this.state.queuedInstructions.length) {
      return false;
    }

    const queuedInstructions = this.state.queuedInstructions.filter((_, idx) => idx !== index);
    this.queuedInstructionEntries = this.queuedInstructionEntries.filter((_, idx) => idx !== index);
    this.updateState({ queuedInstructions, queuedInstructionSequences: this.queueSequences(), queuedInstructionMetadata: this.queueMetadata() });
    return true;
  }

  /** Send an unchanged queue entry into the active turn, then remove that entry. */
  steerQueuedInstruction(index: number, sequence: number | undefined, originalText: string, text: string): boolean {
    const queued = this.queuedInstructionEntries[index];
    if (!queued || sequence === undefined || queued.sequence !== sequence || queued.text !== originalText || !this.options.onSteerQueuedMessage?.(text)) {
      return false;
    }
    return this.removeQueuedInstruction(index);
  }

  private queueSequences(): number[] {
    return this.queuedInstructionEntries.map(entry => entry.sequence);
  }

  /**
   * Remove and return the next queued instruction
   */
  private queueMetadata(): Array<PeerInstructionMetadata | undefined> {
    return this.queuedInstructionEntries.map(entry => entry.peerReferences ? { peerReferences: structuredClone(entry.peerReferences), ...(entry.peerScope ? { peerScope: entry.peerScope } : {}) } : undefined);
  }

  dequeueInstruction(): string | undefined {
    return this.dequeueQueuedInstruction()?.text;
  }

  /** Inspect the oldest queued instruction without mutating the editable UI queue. */
  peekQueuedInstruction(): Readonly<SequencedQueuedWork & Partial<PeerInstructionMetadata>> | undefined {
    return this.queuedInstructionEntries[0];
  }

  /** Remove the oldest queued instruction while retaining its global FIFO ordinal. */
  dequeueQueuedInstruction(): (SequencedQueuedWork & Partial<PeerInstructionMetadata>) | undefined {
    const next = this.queuedInstructionEntries.shift();
    if (!next) return undefined;
    this.updateState({ queuedInstructions: this.state.queuedInstructions.slice(1), queuedInstructionSequences: this.queueSequences(), queuedInstructionMetadata: this.queueMetadata() });
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
    this.queuedInstructionEntries = [];
    this.updateState({ queuedInstructions: [], queuedInstructionSequences: [], queuedInstructionMetadata: [] });
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
    const updates: Partial<AgentUIState> = { finalResponse: response, streamingResponse: null };
    if (!this.state.isWorking) {
      Object.assign(updates, this.archiveIdleReply(this.state.chatMessages, response, this.state.thinking));
    }
    this.updateState(updates);
  }

  /**
   * Move a finished reply (and the thought ahead of it) into the transcript.
   * A reply left in the dynamic frame makes Ink clear the screen and scrollback
   * on every repaint once it is taller than the viewport.
   */
  private archiveIdleReply(
    messages: ChatLogMessage[],
    finalResponse: string | null | undefined,
    thinking: string | null,
  ): Partial<AgentUIState> {
    const reply = finalResponse?.trim();
    if (!reply) {
      return {};
    }
    const archived = this.archiveCompletedTurnMessages(messages, reply, null, thinking);
    return {
      thinking: null,
      ...(archived !== messages ? { chatMessages: archived } : {}),
    };
  }

  /** A transient, bounded view of streamed content while the turn is still running. */
  setStreamingResponse(response: string | null): void {
    this.updateState({ streamingResponse: response });
  }

  /**
   * Clear all state for a new task
   */
  reset(): void {
    const newState = {
      ...createInitialUIState(),
      interactionMode: this.options.getInteractionMode?.() ?? this.state.interactionMode,
      announcement: this.state.announcement,
    };
    this.queuedInstructionEntries = [];
    this.notificationContentsByKey.clear();
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
