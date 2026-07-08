/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, memo, useMemo, useRef, useCallback } from 'react';
import { Box, Static, Text, useInput, useStdout, type Key as InkKey } from 'ink';
import {
  StatusLine,
  formatLineSegments,
  mergeLineExtensions,
  type LineExtension,
  type LineSegment,
} from './StatusLine.js';
import { LiveCommandBlock, ToolOutputStatic, ToolOutputBatchStatic, ThemedDiffOutput, type LiveCommandEntry, type ToolOutputEntry, type ToolOutputBatchEntry, type ToolOutputItem } from './ToolOutput.js';
import { InputLine } from './InputLine.js';
import { ThinkingOutput } from './ThinkingOutput.js';
import { FileMentionDropdown, parseFileSuggestions, matchFileMention, type FileMentionSuggestion } from './FileMentionDropdown.js';
import { SlashCommandDropdown, matchSlashCommand, buildSlashSuggestions, buildSubcommandSuggestions, type SlashCommandSuggestion } from './SlashCommandDropdown.js';
import { SkillMentionDropdown, matchSkillMention, buildSkillSuggestions, type SkillSuggestion } from './SkillMentionDropdown.js';
import type { SlashCommand } from '../../core/slashCommandTypes.js';
import type { SkillMentionInfo } from '../mentionFilter.js';
import { UserMessage } from './UserMessage.js';
import { ShortcutsHelpPanel } from './ShortcutsHelpPanel.js';
import { SitrepMessage, parseSitrepText } from './SitrepMessage.js';
import { useTheme } from '../theme/ThemeContext.js';
import { useTranslation } from '../i18n/index.js';
import { getPlanModeManager } from '../../commands/plan.js';
import type { InputBorderStyle } from '../box.js';
import { TextBuffer } from '../textBuffer.js';
import { handleTextBufferKey, type KeyHandlerResult } from '../textBufferKeyHandler.js';
import {
  getInlineGhostCompletionSuffix,
  getPrimaryHotTipSuggestion,
  getPromptBlockWidth,
  isShiftEnterResidualSequence,
  processImagesInText,
} from '../inputPrompt.js';
import { renderTerminalMarkdown } from '../../core/immediateCommandRouter.js';
import { buildFileMentionSuggestions } from '../mentionFilter.js';
import { getContentDisplay } from '../displayUtils.js';
import type { ChatLogMessage } from '../../session/chatLog.js';
import { formatCompactTokens } from '../../core/agent/AgentFormatter.js';

export interface ContextTokenDisplay {
  used: number;
  total: number;
}

export type TurnCompletionStatus = 'completed' | 'failed';

export interface AgentUIState {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  toolOutputs: ToolOutputItem[];
  liveCommands: LiveCommandEntry[];
  thinking: string | null;
  queuedInstructions: string[];
  /** User messages displayed in the conversation */
  userMessages: string[];
  /** Completed user/assistant turns displayed in order. */
  chatMessages: ChatLogMessage[];
  /** Background notices displayed outside transcript/static chat history. */
  notifications: string[];
  /** Number of chat messages already committed to terminal scrollback by a previous Ink mount. */
  staticChatMessageOffset: number;
  currentInput: string;
  finalResponse: string | null;
  /** Completion stats shown after work finishes */
  completionStats: { elapsed: string; tokens: string; status?: TurnCompletionStatus } | null;
  /** Plan mode indicator (e.g., '[PLAN]' or '[EXEC]') */
  planModeIndicator?: string;
  /** Context percentage remaining (0-100) */
  contextPercent?: number;
  /** Current context occupancy and active model context window. */
  contextTokens?: ContextTokenDisplay;
  /** Current LLM provider key (e.g. 'openai', 'openrouter') */
  provider?: string;
  /** Current LLM model name */
  model?: string;
  /** Optional extension points for the fixed status/help lines. */
  lineExtensions?: AgentUILineExtensions;
  /** Built-in status-line settings rendered separately from extension-provided line extensions. */
  configuredLineExtensions?: AgentUILineExtensions;
  /** Monotonic refresh signal used when lazy suggestion providers resolve. */
  suggestionRefreshId?: number;
}

export interface AgentUILineExtensions {
  status?: LineExtension;
  help?: LineExtension;
}

export interface AgentUIProps {
  state: AgentUIState;
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  onToggleLiveCommandExpanded?: () => void;
  onInputChange?: (input: string) => void;
  enableQueueInput?: boolean;
  /** Called when a dragged/dropped image is detected in the input */
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  /** Provider for file list used in @ mention autocomplete */
  filesProvider?: () => string[];
  /** Slash commands for / autocomplete */
  slashCommands?: SlashCommand[];
  /** Provider for skills used in $ mention autocomplete */
  skillsProvider?: () => SkillMentionInfo[];
  /** Base path used for shell path completion. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Lazy provider for the model-generated empty-input next-prompt suggestion. */
  suggestionProvider?: () => string | undefined;
  /** Legacy resolver accepted for renderer compatibility; `!` input stays free-form. */
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  /** Optional extension points for the fixed status/help lines. */
  lineExtensions?: AgentUILineExtensions;
  /** Replace a queued instruction owned by the renderer. */
  onReplaceQueuedInstruction?: (index: number, text: string) => void;
  /** Remove a queued instruction owned by the renderer. */
  onRemoveQueuedInstruction?: (index: number) => void;
}

interface TextBufferKeyInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

const INK_TEXTBUFFER_VIEWPORT_HEIGHT = 10;
/** Debounce delay for image detection after input changes (ms) */
const INK_IMAGE_SCAN_DELAY_MS = 150;
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const INK_HOME_KEY_INPUTS = new Set(['\x1b[H', '\x1bOH', '\x1b[1~', '\x1b[7~']);
const INK_END_KEY_INPUTS = new Set(['\x1b[F', '\x1bOF', '\x1b[4~', '\x1b[8~']);

interface ChatHistoryItem {
  index: number;
  message: ChatLogMessage;
}

interface MarkdownDiffSegment {
  type: 'text' | 'diff';
  content: string;
}

const DIFF_FENCE_RE = /^```[ \t]*(?:diff|patch)[^\n]*\r?\n([\s\S]*?)^```[ \t]*$/gim;
const GIT_INDEX_RE = /^index [0-9a-f]{4,}\.\.[0-9a-f]{4,}(?: [0-7]{6})?$/i;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

function hasFileHeaderPair(lines: string[], index: number): boolean {
  return /^---\s+/.test(lines[index] ?? '') && /^\+\+\+\s+/.test(lines[index + 1] ?? '');
}

function isRawDiffStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (line.startsWith('diff --git ')) {
    return true;
  }
  if (GIT_INDEX_RE.test(line)) {
    return lines.slice(index + 1, index + 5).some((candidate, offset) =>
      /^---\s+/.test(candidate) && /^\+\+\+\s+/.test(lines[index + 2 + offset] ?? '')
    );
  }
  if (hasFileHeaderPair(lines, index)) {
    return true;
  }
  if (HUNK_HEADER_RE.test(line)) {
    return true;
  }
  return false;
}

function isRawDiffContinuation(line: string): boolean {
  return line === '' ||
    line.startsWith('diff --git ') ||
    GIT_INDEX_RE.test(line) ||
    /^---\s+/.test(line) ||
    /^\+\+\+\s+/.test(line) ||
    HUNK_HEADER_RE.test(line) ||
    line.startsWith('+') ||
    line.startsWith('-') ||
    line.startsWith(' ') ||
    line.startsWith('\\ No newline');
}

function splitRawDiffSegments(content: string): MarkdownDiffSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: MarkdownDiffSegment[] = [];
  let textLines: string[] = [];
  let index = 0;

  const flushText = (): void => {
    if (textLines.length > 0) {
      segments.push({ type: 'text', content: textLines.join('\n') });
      textLines = [];
    }
  };

  while (index < lines.length) {
    if (!isRawDiffStart(lines, index)) {
      textLines.push(lines[index] ?? '');
      index += 1;
      continue;
    }

    flushText();
    const diffLines: string[] = [];
    while (index < lines.length && isRawDiffContinuation(lines[index] ?? '')) {
      diffLines.push(lines[index] ?? '');
      index += 1;
    }
    segments.push({ type: 'diff', content: diffLines.join('\n').trimEnd() });
  }

  flushText();
  return segments;
}

export function splitMarkdownDiffFences(content: string): MarkdownDiffSegment[] {
  const segments: MarkdownDiffSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(DIFF_FENCE_RE)) {
    const start = match.index ?? 0;
    const before = content.slice(cursor, start);
    if (before) {
      segments.push(...splitRawDiffSegments(before));
    }
    segments.push({ type: 'diff', content: (match[1] ?? '').trimEnd() });
    cursor = start + match[0].length;
  }

  const after = content.slice(cursor);
  if (after) {
    segments.push(...splitRawDiffSegments(after));
  }

  return segments.length > 0 ? segments : [{ type: 'text', content }];
}

export interface InkPasteState {
  isInPaste: boolean;
  buffer: string;
  hiddenContent: string | null;
  hiddenPastes?: Array<{ visual: string; actual: string }>;
  hiddenPlaceholder?: string | null;
}

export interface InkPasteConsumeResult {
  handled: boolean;
  completedText?: string;
}

function getInkTextBufferViewportWidth(columns: number | undefined): number {
  return Math.max(1, getPromptBlockWidth(columns) - 4);
}

function mapInkKeyToTextBufferKey(input: string, key: InkKey): TextBufferKeyInfo {
  let name: string | undefined;

  if (key.leftArrow) {
    name = 'left';
  } else if (key.rightArrow) {
    name = 'right';
  } else if (key.upArrow) {
    name = 'up';
  } else if (key.downArrow) {
    name = 'down';
  } else if (key.return) {
    name = 'return';
  } else if (key.backspace) {
    name = 'backspace';
  } else if (input === '\x7f' || input === '\b') {
    name = 'backspace';
  } else if (key.delete) {
    name = 'delete';
  } else if (input === '\x1b[3~') {
    name = 'delete';
  } else if (key.tab) {
    name = 'tab';
  } else if (INK_HOME_KEY_INPUTS.has(input)) {
    name = 'home';
  } else if (INK_END_KEY_INPUTS.has(input)) {
    name = 'end';
  } else if (key.ctrl && input === 'a') {
    name = 'a';
  } else if (key.ctrl && input === 'e') {
    name = 'e';
  }

  return {
    name,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
    sequence: input,
  };
}

function useTerminalWindowSize(): { columns: number | undefined; rows: number | undefined } {
  const { stdout } = useStdout();
  const [windowSize, setWindowSize] = useState(() => ({
    columns: stdout.columns,
    rows: stdout.rows,
  }));

  useEffect(() => {
    const updateWindowSize = () => {
      setWindowSize({
        columns: stdout.columns,
        rows: stdout.rows,
      });
    };

    updateWindowSize();
    stdout.on('resize', updateWindowSize);

    return () => {
      stdout.off('resize', updateWindowSize);
    };
  }, [stdout]);

  return windowSize;
}

export function getTextBufferCursorOffset(buffer: TextBuffer): number {
  const lines = buffer.getLines();
  const row = buffer.getCursorRow();
  const col = buffer.getCursorCol();
  let offset = 0;

  for (let i = 0; i < row; i++) {
    offset += lines[i]?.length ?? 0;
    offset += 1;
  }

  return offset + col;
}

const COMPOSER_TRIGGER_CHARS = new Set(['/', '@', '$', '!', '#']);
const INVISIBLE_OR_WHITESPACE_RE = /[\s\u200B-\u200D\uFEFF]/u;

function compactComposerTriggerText(text: string): string {
  return Array.from(text)
    .filter(char => !INVISIBLE_OR_WHITESPACE_RE.test(char))
    .join('');
}

export function isBareComposerTrigger(text: string, cursorOffset = text.length): boolean {
  const compactText = compactComposerTriggerText(text);
  if (compactText.length !== 1 || !COMPOSER_TRIGGER_CHARS.has(compactText)) {
    return false;
  }

  const compactBeforeCursor = compactComposerTriggerText(text.slice(0, cursorOffset));
  return compactBeforeCursor === compactText;
}

export function clearBareComposerTrigger(buffer: TextBuffer): boolean {
  if (!isBareComposerTrigger(buffer.getText(), getTextBufferCursorOffset(buffer))) {
    return false;
  }

  buffer.setText('');
  return true;
}

function isForwardDeleteKey(input: string, key: InkKey): boolean {
  return key.delete || input === '\x1b[3~';
}

export function consumeInkBracketedPasteInput(
  input: string,
  pasteState: InkPasteState
): InkPasteConsumeResult {
  if (!input) {
    return { handled: false };
  }

  if (pasteState.isInPaste) {
    const endIndex = input.indexOf(BRACKETED_PASTE_END);
    if (endIndex === -1) {
      pasteState.buffer += input;
      return { handled: true };
    }

    const completedText = pasteState.buffer + input.slice(0, endIndex);
    pasteState.isInPaste = false;
    pasteState.buffer = '';
    return { handled: true, completedText };
  }

  const startIndex = input.indexOf(BRACKETED_PASTE_START);
  if (startIndex === -1) {
    return { handled: false };
  }

  const pasteStart = startIndex + BRACKETED_PASTE_START.length;
  const afterStart = input.slice(pasteStart);
  const endIndex = afterStart.indexOf(BRACKETED_PASTE_END);
  if (endIndex === -1) {
    pasteState.isInPaste = true;
    pasteState.buffer = afterStart;
    return { handled: true };
  }

  return {
    handled: true,
    completedText: afterStart.slice(0, endIndex),
  };
}

export function storeInkHiddenPaste(
  pasteState: InkPasteState,
  visual: string,
  actual: string
): void {
  pasteState.hiddenContent = actual;
  pasteState.hiddenPlaceholder = visual;
  pasteState.hiddenPastes = [...(pasteState.hiddenPastes ?? []), { visual, actual }];
}

export function clearInkHiddenPastes(pasteState: InkPasteState): void {
  pasteState.hiddenContent = null;
  delete pasteState.hiddenPlaceholder;
  pasteState.hiddenPastes = [];
}

export function resolveInkHiddenPastes(text: string, pasteState: InkPasteState): string {
  let resolved = text;

  for (const paste of pasteState.hiddenPastes ?? []) {
    resolved = resolved.replace(paste.visual, paste.actual);
  }

  return resolved;
}

export function resolveInkComposerSubmitText(
  visibleText: string,
  pasteState: Pick<InkPasteState, 'hiddenContent' | 'hiddenPlaceholder'>
): string {
  const { hiddenContent, hiddenPlaceholder } = pasteState;
  if (!hiddenContent || !hiddenPlaceholder || !visibleText.includes(hiddenPlaceholder)) {
    return visibleText;
  }

  return visibleText.replace(hiddenPlaceholder, hiddenContent);
}

export function clearInkComposerInputForSubmit(
  buffer: TextBuffer,
  pasteState: InkPasteState,
  options: {
    setInput: (value: string) => void;
    setCursorOffset: (value: number) => void;
    onInputChange?: (value: string) => void;
    clearPendingInputSync?: () => void;
  }
): void {
  buffer.setText('');
  clearInkHiddenPastes(pasteState);
  options.clearPendingInputSync?.();
  options.setInput('');
  options.setCursorOffset(0);
  options.onInputChange?.('');
}

export function handleInkTextBufferInput(
  buffer: TextBuffer,
  input: string,
  key: InkKey
): KeyHandlerResult {
  if (isShiftEnterResidualSequence(input)) {
    buffer.insert('\n');
    return 'handled';
  }

  if (isForwardDeleteKey(input, key) && clearBareComposerTrigger(buffer)) {
    return 'handled';
  }

  return handleTextBufferKey(buffer, input, mapInkKeyToTextBufferKey(input, key));
}

export function getComposerHelpLine(
  _isWorking: boolean,
  providerDisplay: string,
  contextDisplay: string | ContextTokenDisplay,
  commandHint: string,
  lineExtension?: LineExtension
): string {
  const contextText = typeof contextDisplay === 'string'
    ? contextDisplay
    : formatContextTokenDisplay(contextDisplay);
  const defaultSegments: LineSegment[] = [
    { id: 'provider', text: providerDisplay },
    { id: 'context', text: contextText },
    { id: 'command-hint', text: commandHint },
  ];

  return formatLineSegments(defaultSegments, lineExtension);
}

function formatContextTokenDisplay(contextTokens: ContextTokenDisplay): string {
  if (!Number.isFinite(contextTokens.total) || contextTokens.total <= 0) {
    return '';
  }

  const used = Math.max(0, contextTokens.used);
  const ratio = Math.max(0, Math.min(used / contextTokens.total, 1));
  return `context: ${(ratio * 100).toFixed(1)}% (${formatCompactTokens(used)}/${formatCompactTokens(contextTokens.total)})`;
}

/**
 * Check if text potentially contains an image path (quick heuristic).
 * Mirrors the logic from inputPrompt.ts.
 */
function hasPotentialImagePath(text: string): boolean {
  const imageExtPattern = /\.(png|jpg|jpeg|gif|webp)$/i;
  // Check for quoted paths, escaped paths, or simple paths
  if (imageExtPattern.test(text)) {
    return true;
  }
  if (/["'].*\.(png|jpg|jpeg|gif|webp)["']/i.test(text)) {
    return true;
  }
  return false;
}

function normalizeComposerSuggestionCandidate(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function matchesCurrentAssistantResponseSuggestion(
  suggestion: string,
  state: AgentUIState
): boolean {
  const normalizedSuggestion = normalizeComposerSuggestionCandidate(suggestion);
  if (!normalizedSuggestion) {
    return false;
  }

  const assistantCandidates = [
    state.finalResponse,
    ...state.chatMessages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content),
  ];

  return assistantCandidates.some((candidate) => {
    const normalizedCandidate = normalizeComposerSuggestionCandidate(candidate);
    if (!normalizedCandidate) {
      return false;
    }
    if (normalizedSuggestion === normalizedCandidate) {
      return true;
    }
    if (normalizedSuggestion.endsWith('\u2026')) {
      return normalizedCandidate.startsWith(normalizedSuggestion.slice(0, -1));
    }
    return false;
  });
}

export function AgentUI({
  state,
  onInstruction,
  onEscape,
  onCtrlC,
  onToggleLiveCommandExpanded,
  onInputChange,
  enableQueueInput = true,
  onImageDetected,
  filesProvider,
  slashCommands,
  skillsProvider,
  workspaceRoot,
  suggestionProvider,
  lineExtensions,
  onReplaceQueuedInstruction,
  onRemoveQueuedInstruction,
}: AgentUIProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [input, setInput] = useState(state.currentInput || '');
  const [cursorOffset, setCursorOffset] = useState((state.currentInput || '').length);
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [planModeIndicator, setPlanModeIndicator] = useState('');
  const [planModeStatusKey, setPlanModeStatusKey] = useState('');
  const [queueSelectionIndex, setQueueSelectionIndex] = useState<number | null>(null);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  
  // File mention autocomplete state
  const [fileMentionSuggestions, setFileMentionSuggestions] = useState<FileMentionSuggestion[]>([]);
  const [fileMentionActiveIndex, setFileMentionActiveIndex] = useState(0);
  const [fileMentionVisible, setFileMentionVisible] = useState(false);
  const fileMentionStartIndexRef = useRef<number | null>(null);

  // Slash command autocomplete state
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommandSuggestion[]>([]);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashVisible, setSlashVisible] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const slashStartIndexRef = useRef<number | null>(null);
  const slashFullMatchRef = useRef<string | null>(null);

  // Skill ($) mention autocomplete state
  const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>([]);
  const [skillActiveIndex, setSkillActiveIndex] = useState(0);
  const [skillVisible, setSkillVisible] = useState(false);
  const skillStartIndexRef = useRef<number | null>(null);
  const textBufferRef = useRef<TextBuffer>(
    new TextBuffer(
      getInkTextBufferViewportWidth(process.stdout.columns),
      INK_TEXTBUFFER_VIEWPORT_HEIGHT,
      state.currentInput || undefined
    )
  );

  // Track the last processed input to avoid re-processing the same text
  const lastProcessedInputRef = useRef<string>('');
  // Debounce timer for image scanning
  const imageScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Paste state tracking for bracketed paste mode
  const pasteStateRef = useRef<InkPasteState>({
    isInPaste: false,
    buffer: '',
    hiddenContent: null,
    hiddenPastes: [],
  });

  // Refs for stable input handler access — prevents useInput re-registration
  // on every render while keeping handler logic up-to-date.
  const inputRef = useRef(input);
  inputRef.current = input;
  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;
  const fileMentionVisibleRef = useRef(fileMentionVisible);
  fileMentionVisibleRef.current = fileMentionVisible;
  const fileMentionSuggestionsRef = useRef(fileMentionSuggestions);
  fileMentionSuggestionsRef.current = fileMentionSuggestions;
  const fileMentionActiveIndexRef = useRef(fileMentionActiveIndex);
  fileMentionActiveIndexRef.current = fileMentionActiveIndex;
  const isWorkingRef = useRef(state.isWorking);
  isWorkingRef.current = state.isWorking;
  const liveCommandsRef = useRef(state.liveCommands);
  liveCommandsRef.current = state.liveCommands;
  const enableQueueInputRef = useRef(enableQueueInput);
  enableQueueInputRef.current = enableQueueInput;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onCtrlCRef = useRef(onCtrlC);
  onCtrlCRef.current = onCtrlC;
  const onToggleLiveCommandExpandedRef = useRef(onToggleLiveCommandExpanded);
  onToggleLiveCommandExpandedRef.current = onToggleLiveCommandExpanded;
  const onInstructionRef = useRef(onInstruction);
  onInstructionRef.current = onInstruction;
  const onInputChangeRef = useRef(onInputChange);
  onInputChangeRef.current = onInputChange;
  const onReplaceQueuedInstructionRef = useRef(onReplaceQueuedInstruction);
  onReplaceQueuedInstructionRef.current = onReplaceQueuedInstruction;
  const onRemoveQueuedInstructionRef = useRef(onRemoveQueuedInstruction);
  onRemoveQueuedInstructionRef.current = onRemoveQueuedInstruction;
  const queuedInstructionsRef = useRef(state.queuedInstructions);
  queuedInstructionsRef.current = state.queuedInstructions;
  const queueSelectionIndexRef = useRef(queueSelectionIndex);
  queueSelectionIndexRef.current = queueSelectionIndex;
  const editingQueueIndexRef = useRef(editingQueueIndex);
  editingQueueIndexRef.current = editingQueueIndex;
  const onImageDetectedRef = useRef(onImageDetected);
  onImageDetectedRef.current = onImageDetected;
  const filesProviderRef = useRef(filesProvider);
  filesProviderRef.current = filesProvider;
  const slashCommandsRef = useRef(slashCommands);
  slashCommandsRef.current = slashCommands;
  const slashVisibleRef = useRef(slashVisible);
  slashVisibleRef.current = slashVisible;
  const slashSuggestionsRef = useRef(slashSuggestions);
  slashSuggestionsRef.current = slashSuggestions;
  const slashActiveIndexRef = useRef(slashActiveIndex);
  slashActiveIndexRef.current = slashActiveIndex;
  const showShortcutsRef = useRef(showShortcuts);
  showShortcutsRef.current = showShortcuts;
  const skillsProviderRef = useRef(skillsProvider);
  skillsProviderRef.current = skillsProvider;
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;
  const suggestionProviderRef = useRef(suggestionProvider);
  suggestionProviderRef.current = suggestionProvider;
  const skillVisibleRef = useRef(skillVisible);
  skillVisibleRef.current = skillVisible;
  const skillSuggestionsRef = useRef(skillSuggestions);
  skillSuggestionsRef.current = skillSuggestions;
  const skillActiveIndexRef = useRef(skillActiveIndex);
  skillActiveIndexRef.current = skillActiveIndex;
  // The TextBuffer is the keystroke source of truth. Sync it into React and
  // the renderer owner immediately so pause/resume, submit, and external
  // status updates cannot observe a stale composer draft.
  const inputSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputSyncRef = useRef<{ text: string; offset: number } | null>(null);

  const flushInputSync = useCallback(() => {
    inputSyncTimerRef.current = null;
    const pending = pendingInputSyncRef.current;
    if (!pending) return;
    pendingInputSyncRef.current = null;
    setInput(pending.text);
    setCursorOffset(pending.offset);
    onInputChangeRef.current?.(pending.text);
  }, []);

  const syncInputFromBuffer = useCallback(() => {
    const buffer = textBufferRef.current;
    pendingInputSyncRef.current = {
      text: buffer.getText(),
      offset: getTextBufferCursorOffset(buffer),
    };
    flushInputSync();
  }, [flushInputSync]);

  const lastColumnsRef = useRef(process.stdout.columns);

  const syncBufferViewport = useCallback(() => {
    const columns = process.stdout.columns;
    if (columns === lastColumnsRef.current) return;
    lastColumnsRef.current = columns;
    textBufferRef.current.setViewport(
      getInkTextBufferViewportWidth(columns),
      INK_TEXTBUFFER_VIEWPORT_HEIGHT
    );
  }, []);

  const dismissAutocompleteState = useCallback(() => {
    slashVisibleRef.current = false;
    slashSuggestionsRef.current = [];
    slashStartIndexRef.current = null;
    slashFullMatchRef.current = null;
    setSlashVisible(false);
    setSlashSuggestions([]);

    skillVisibleRef.current = false;
    skillSuggestionsRef.current = [];
    skillStartIndexRef.current = null;
    setSkillVisible(false);
    setSkillSuggestions([]);

    fileMentionVisibleRef.current = false;
    fileMentionSuggestionsRef.current = [];
    fileMentionStartIndexRef.current = null;
    setFileMentionVisible(false);
    setFileMentionSuggestions([]);

  }, []);

  const insertPastedText = useCallback((pastedText: string) => {
    const imageDetector = onImageDetectedRef.current;
    const processedText = imageDetector
      ? processImagesInText(pastedText, imageDetector, { announce: false })
      : pastedText;
    const display = getContentDisplay(processedText);
    const pasteState = pasteStateRef.current;
    const buffer = textBufferRef.current;

    if (display.isPasted) {
      storeInkHiddenPaste(pasteState, display.visual, display.actual);
      buffer.insert(display.visual);
    } else {
      clearInkHiddenPastes(pasteState);
      buffer.insert(processedText);
    }

    syncInputFromBuffer();
  }, [syncInputFromBuffer]);

  const acceptActiveAutocompleteSuggestion = useCallback((options?: { preserveExactSlashSubmit?: boolean }): boolean => {
    if (slashVisibleRef.current && slashSuggestionsRef.current.length > 0 && slashStartIndexRef.current !== null) {
      const suggestion = slashSuggestionsRef.current[slashActiveIndexRef.current];
      if (!suggestion) {
        return false;
      }

      const buffer = textBufferRef.current;
      const currentText = buffer.getText();
      if (options?.preserveExactSlashSubmit && currentText.trim() === suggestion.command) {
        return false;
      }

      const beforeSlash = currentText.slice(0, slashStartIndexRef.current);
      const afterCursor = currentText.slice(getTextBufferCursorOffset(buffer));
      const replacement = `${suggestion.command} `;
      buffer.setText(beforeSlash + replacement + afterCursor);
      syncInputFromBuffer();

      setSlashVisible(false);
      setSlashSuggestions([]);
      slashStartIndexRef.current = null;
      slashFullMatchRef.current = null;
      return true;
    }

    if (skillVisibleRef.current && skillSuggestionsRef.current.length > 0 && skillStartIndexRef.current !== null) {
      const suggestion = skillSuggestionsRef.current[skillActiveIndexRef.current];
      if (!suggestion) {
        return false;
      }

      const buffer = textBufferRef.current;
      const currentText = buffer.getText();
      const beforeMention = currentText.slice(0, skillStartIndexRef.current);
      const afterCursor = currentText.slice(getTextBufferCursorOffset(buffer));
      const replacement = `${suggestion.name} `;
      buffer.setText(beforeMention + replacement + afterCursor);
      syncInputFromBuffer();

      setSkillVisible(false);
      setSkillSuggestions([]);
      skillStartIndexRef.current = null;
      return true;
    }

    if (fileMentionVisibleRef.current && fileMentionSuggestionsRef.current.length > 0 && fileMentionStartIndexRef.current !== null) {
      const suggestion = fileMentionSuggestionsRef.current[fileMentionActiveIndexRef.current];
      if (!suggestion) {
        return false;
      }

      const buffer = textBufferRef.current;
      const currentText = buffer.getText();
      const beforeMention = currentText.slice(0, fileMentionStartIndexRef.current);
      const afterCursor = currentText.slice(getTextBufferCursorOffset(buffer));
      const replacement = `@${suggestion.path} `;
      buffer.setText(beforeMention + replacement + afterCursor);
      syncInputFromBuffer();

      setFileMentionVisible(false);
      setFileMentionSuggestions([]);
      fileMentionStartIndexRef.current = null;
      return true;
    }

    return false;
  }, [syncInputFromBuffer]);

  // Subscribe to plan mode changes
  useEffect(() => {
    const planModeManager = getPlanModeManager();
    const updateIndicator = () => {
      setPlanModeIndicator(planModeManager.getPromptIndicator());
      setPlanModeStatusKey(planModeManager.getStatusDescriptionKey());
    };

    planModeManager.on('enabled', updateIndicator);
    planModeManager.on('disabled', updateIndicator);
    planModeManager.on('execution:started', updateIndicator);

    // Set initial indicator
    updateIndicator();

    return () => {
      planModeManager.off('enabled', updateIndicator);
      planModeManager.off('disabled', updateIndicator);
      planModeManager.off('execution:started', updateIndicator);
    };
  }, []);

  // Sync input changes to parent for preservation across pause/resume
  useEffect(() => {
    onInputChange?.(input);
  }, [input, onInputChange]);

  // Sync viewport on every render. Terminal resize flows through
  // useTerminalWindowSize(), which gives React a real update when stdout emits resize.
  useEffect(() => {
    syncBufferViewport();
  }, [syncBufferViewport]);

  useEffect(() => {
    const buffer = textBufferRef.current;
    if (state.currentInput !== buffer.getText()) {
      buffer.setText(state.currentInput || '');
      syncInputFromBuffer();
    }
  }, [state.currentInput, syncInputFromBuffer]);

  useEffect(() => {
    const queueLength = state.queuedInstructions.length;
    setQueueSelectionIndex((current) => {
      if (current === null) {
        return null;
      }
      if (queueLength === 0) {
        return null;
      }
      return Math.min(current, queueLength - 1);
    });
    setEditingQueueIndex((current) => {
      if (current === null) {
        return null;
      }
      if (queueLength === 0) {
        return null;
      }
      return Math.min(current, queueLength - 1);
    });
  }, [state.queuedInstructions.length]);

  // Reset ctrl+c count after 2 seconds
  useEffect(() => {
    if (ctrlCCount > 0) {
      const timer = setTimeout(() => setCtrlCCount(0), 2000);
      return () => clearTimeout(timer);
    }
  }, [ctrlCCount]);

  // Debounced image detection: when input changes and contains potential image paths,
  // process them through processImagesInText and update the input with [Image #N] placeholders.
  useEffect(() => {
    if (!onImageDetected) {
      return;
    }

    // Clear any pending scan
    if (imageScanTimerRef.current) {
      clearTimeout(imageScanTimerRef.current);
      imageScanTimerRef.current = null;
    }

    // Skip if already processed (e.g., after a replacement)
    if (input === lastProcessedInputRef.current) {
      return;
    }

    // Quick heuristic check before scheduling the scan
    if (!hasPotentialImagePath(input)) {
      lastProcessedInputRef.current = input;
      return;
    }

    // Debounce: wait for typing to settle before scanning
    imageScanTimerRef.current = setTimeout(() => {
      imageScanTimerRef.current = null;

      const processed = processImagesInText(input, onImageDetected, {
        announce: false,
      });

      if (processed !== input) {
        // Image was detected and replaced with [Image #N]
        lastProcessedInputRef.current = processed;
        clearInkHiddenPastes(pasteStateRef.current);
        const buffer = textBufferRef.current;
        buffer.setText(processed);
        syncInputFromBuffer();
      } else {
        lastProcessedInputRef.current = input;
      }
    }, INK_IMAGE_SCAN_DELAY_MS);

    return () => {
      if (imageScanTimerRef.current) {
        clearTimeout(imageScanTimerRef.current);
        imageScanTimerRef.current = null;
      }
    };
  }, [input, onImageDetected, syncInputFromBuffer]);

  // Update file mention suggestions when input changes
  useEffect(() => {
    if (!filesProvider) {
      setFileMentionVisible(false);
      setFileMentionSuggestions([]);
      return;
    }

    // Guard against stale React state if the buffer has already moved ahead
    // of this render. The synchronous handler updates refs immediately.
    const buffer = textBufferRef.current;
    if (input !== buffer.getText() || cursorOffset !== getTextBufferCursorOffset(buffer)) {
      return;
    }

    const mention = matchFileMention(input, cursorOffset);
    if (!mention) {
      setFileMentionVisible(false);
      setFileMentionSuggestions([]);
      fileMentionStartIndexRef.current = null;
      return;
    }

    const files = filesProvider();
    const matchingFiles = buildFileMentionSuggestions(files, mention.seed, 5);
    
    if (matchingFiles.length === 0) {
      setFileMentionVisible(false);
      setFileMentionSuggestions([]);
      fileMentionStartIndexRef.current = null;
      return;
    }

    fileMentionStartIndexRef.current = mention.startIndex;
    setFileMentionSuggestions(parseFileSuggestions(matchingFiles));
    setFileMentionVisible(true);
    setFileMentionActiveIndex(prev => Math.min(prev, matchingFiles.length - 1));
  }, [input, cursorOffset, filesProvider]);

  // Update slash command suggestions when input changes
  useEffect(() => {
    const cmds = slashCommandsRef.current;
    if (!cmds || cmds.length === 0) {
      setSlashVisible(false);
      setSlashSuggestions([]);
      return;
    }

    // Guard against stale React state (same pattern as file mentions).
    const buffer = textBufferRef.current;
    if (input !== buffer.getText() || cursorOffset !== getTextBufferCursorOffset(buffer)) {
      return;
    }

    const trimmed = input.replace(/^\s+/, '');
    if (!trimmed.startsWith('/')) {
      setSlashVisible(false);
      setSlashSuggestions([]);
      slashStartIndexRef.current = null;
      slashFullMatchRef.current = null;
      return;
    }

    // Check subcommand mode first (e.g. "/learn " → show subcommands)
    const subcommandResult = buildSubcommandSuggestions(trimmed, cmds);
    if (subcommandResult !== null) {
      if (subcommandResult.length > 0) {
        const match = matchSlashCommand(input, cursorOffset);
        slashStartIndexRef.current = match?.startIndex ?? 0;
        slashFullMatchRef.current = trimmed;
        setSlashSuggestions(subcommandResult);
        setSlashVisible(true);
        setSlashActiveIndex(prev => Math.min(prev, subcommandResult.length - 1));
      } else {
        setSlashVisible(false);
        setSlashSuggestions([]);
      }
      return;
    }

    // Top-level command matching (e.g. "/mo" → /model)
    const match = matchSlashCommand(input, cursorOffset);
    if (!match) {
      setSlashVisible(false);
      setSlashSuggestions([]);
      slashStartIndexRef.current = null;
      slashFullMatchRef.current = null;
      return;
    }

    const suggestions = buildSlashSuggestions(match.seed, cmds);
    if (suggestions.length === 0) {
      setSlashVisible(false);
      setSlashSuggestions([]);
      slashStartIndexRef.current = null;
      slashFullMatchRef.current = null;
      return;
    }

    slashStartIndexRef.current = match.startIndex;
    slashFullMatchRef.current = input.slice(match.startIndex);
    setSlashSuggestions(suggestions);
    setSlashVisible(true);
    setSlashActiveIndex(prev => Math.min(prev, suggestions.length - 1));
  }, [input, cursorOffset]);

  // Update skill ($) mention suggestions when input changes
  useEffect(() => {
    const provider = skillsProviderRef.current;
    if (!provider) {
      if (skillVisibleRef.current) {
        setSkillVisible(false);
        setSkillSuggestions([]);
        skillStartIndexRef.current = null;
      }
      return;
    }

    const buffer = textBufferRef.current;
    if (input !== buffer.getText() || cursorOffset !== getTextBufferCursorOffset(buffer)) {
      return;
    }

    const mention = matchSkillMention(input, cursorOffset);
    if (!mention) {
      if (skillVisibleRef.current) {
        setSkillVisible(false);
        setSkillSuggestions([]);
        skillStartIndexRef.current = null;
      }
      return;
    }

    const suggestions = buildSkillSuggestions(mention.seed, provider());
    if (suggestions.length === 0) {
      if (skillVisibleRef.current) {
        setSkillVisible(false);
        setSkillSuggestions([]);
        skillStartIndexRef.current = null;
      }
      return;
    }

    skillStartIndexRef.current = mention.startIndex;
    setSkillSuggestions(suggestions);
    setSkillVisible(true);
    setSkillActiveIndex(prev => Math.min(prev, suggestions.length - 1));
  }, [input, cursorOffset]);

  // Stable input handler that reads mutable values from refs.
  // Empty dependency array means useInput never re-registers, eliminating
  // a major source of flicker during rapid keystrokes.
  const handleInput = useCallback((char: string, key: InkKey) => {
    syncBufferViewport();

    const pasteResult = consumeInkBracketedPasteInput(char, pasteStateRef.current);
    if (pasteResult.handled) {
      if (pasteResult.completedText !== undefined) {
        insertPastedText(pasteResult.completedText);
      }
      return;
    }

    // Handle Shift+Tab for plan mode toggle
    if (key.tab && key.shift) {
      const planModeManager = getPlanModeManager();
      planModeManager.handleShiftTab();
      return;
    }

    // Handle escape - cancel current operation
    if (key.escape) {
      // Close any open dropdowns/menus first before calling onEscape
      if (slashVisibleRef.current || skillVisibleRef.current || fileMentionVisibleRef.current) {
        dismissAutocompleteState();
        if (clearBareComposerTrigger(textBufferRef.current)) {
          syncInputFromBuffer();
          setCtrlCCount(0);
        }
        return;
      }
      if (queueSelectionIndexRef.current !== null || editingQueueIndexRef.current !== null) {
        const wasEditingQueue = editingQueueIndexRef.current !== null;
        queueSelectionIndexRef.current = null;
        editingQueueIndexRef.current = null;
        setQueueSelectionIndex(null);
        setEditingQueueIndex(null);
        if (wasEditingQueue) {
          textBufferRef.current.setText('');
          clearInkHiddenPastes(pasteStateRef.current);
          syncInputFromBuffer();
        }
        setCtrlCCount(0);
        return;
      }
      if (clearBareComposerTrigger(textBufferRef.current)) {
        dismissAutocompleteState();
        syncInputFromBuffer();
        setCtrlCCount(0);
        return;
      }
      if (showShortcutsRef.current) {
        setShowShortcuts(false);
        return;
      }
      onEscapeRef.current();
      return;
    }

    // Handle Ctrl+C - clear input if non-empty, otherwise warn then exit
    if (key.ctrl && char === 'c') {
      const currentInput = textBufferRef.current.getText();

      if (currentInput.length > 0) {
        // Clear the input on first Ctrl+C when there's text
        textBufferRef.current.setText('');
        clearInkHiddenPastes(pasteStateRef.current);
        syncInputFromBuffer();
        setCtrlCCount(0);
        return;
      }

      // Input is empty: first press shows the warning, second asks the host
      // runtime to abort active work and exit instead of queueing /quit.
      // Use functional update to avoid dependency on ctrlCCount.
      setCtrlCCount(prev => {
        if (prev === 0) {
          return 1;
        } else {
          setImmediate(() => onCtrlCRef.current());
          return prev;
        }
      });
      return;
    }

    if (key.ctrl && char === 'o' && liveCommandsRef.current.length > 0) {
      onToggleLiveCommandExpandedRef.current?.();
      return;
    }

    // Block input only when working AND queue-input is disabled.
    // When idle (isWorking=false), always allow input so the user can
    // compose their next prompt.
    if (isWorkingRef.current && !enableQueueInputRef.current) {
      return;
    }

    const queueLength = queuedInstructionsRef.current.length;
    const currentComposerText = textBufferRef.current.getText();
    const selectedQueueIndex = queueSelectionIndexRef.current;
    const canNavigateQueue =
      isWorkingRef.current &&
      enableQueueInputRef.current &&
      editingQueueIndexRef.current === null &&
      queueLength > 0 &&
      currentComposerText.trim().length === 0 &&
      !slashVisibleRef.current &&
      !skillVisibleRef.current &&
      !fileMentionVisibleRef.current;

    if (canNavigateQueue && (key.upArrow || key.downArrow)) {
      const nextIndex = selectedQueueIndex === null
        ? (key.upArrow ? queueLength - 1 : 0)
        : key.upArrow
          ? (selectedQueueIndex > 0 ? selectedQueueIndex - 1 : queueLength - 1)
          : (selectedQueueIndex < queueLength - 1 ? selectedQueueIndex + 1 : 0);
      queueSelectionIndexRef.current = nextIndex;
      setQueueSelectionIndex(nextIndex);
      setCtrlCCount(0);
      return;
    }

    if (canNavigateQueue && selectedQueueIndex !== null && (key.delete || key.backspace)) {
      onRemoveQueuedInstructionRef.current?.(selectedQueueIndex);
      queueSelectionIndexRef.current = null;
      editingQueueIndexRef.current = null;
      setQueueSelectionIndex(null);
      setEditingQueueIndex(null);
      setCtrlCCount(0);
      return;
    }

    if (canNavigateQueue && selectedQueueIndex !== null && key.return) {
      const selectedInstruction = queuedInstructionsRef.current[selectedQueueIndex];
      if (selectedInstruction !== undefined) {
        textBufferRef.current.setText(selectedInstruction);
        editingQueueIndexRef.current = selectedQueueIndex;
        setEditingQueueIndex(selectedQueueIndex);
        syncInputFromBuffer();
      }
      setCtrlCCount(0);
      return;
    }

    // Handle arrow keys for slash / skill / file mention / shell navigation
    // Priority: slash > skill > file mention > shell (only one is ever visible)
    if (slashVisibleRef.current && slashSuggestionsRef.current.length > 0) {
      if (key.upArrow) {
        setSlashActiveIndex(prev =>
          prev > 0 ? prev - 1 : slashSuggestionsRef.current.length - 1
        );
        return;
      }
      if (key.downArrow) {
        setSlashActiveIndex(prev =>
          prev < slashSuggestionsRef.current.length - 1 ? prev + 1 : 0
        );
        return;
      }
    } else if (skillVisibleRef.current && skillSuggestionsRef.current.length > 0) {
      if (key.upArrow) {
        setSkillActiveIndex(prev =>
          prev > 0 ? prev - 1 : skillSuggestionsRef.current.length - 1
        );
        return;
      }
      if (key.downArrow) {
        setSkillActiveIndex(prev =>
          prev < skillSuggestionsRef.current.length - 1 ? prev + 1 : 0
        );
        return;
      }
    } else if (fileMentionVisibleRef.current && fileMentionSuggestionsRef.current.length > 0) {
      if (key.upArrow) {
        setFileMentionActiveIndex(prev => 
          prev > 0 ? prev - 1 : fileMentionSuggestionsRef.current.length - 1
        );
        return;
      }
      if (key.downArrow) {
        setFileMentionActiveIndex(prev => 
          prev < fileMentionSuggestionsRef.current.length - 1 ? prev + 1 : 0
        );
        return;
      }
    }

    if (
      (key.return || key.rightArrow) &&
      acceptActiveAutocompleteSuggestion({
        preserveExactSlashSubmit: key.return,
      })
    ) {
      return;
    }

    // Handle Tab for slash / skill / file mention acceptance
    // Priority matches the arrow-key block above
    if (key.tab && !key.shift) {
      if (acceptActiveAutocompleteSuggestion()) {
        return;
      }

      const buffer = textBufferRef.current;
      const currentText = buffer.getText();
      const trimmedText = currentText.trim();

      if (trimmedText.length === 0) {
        const suggestion = suggestionProviderRef.current?.();
        if (suggestion?.trim()) {
          buffer.setText(suggestion);
          syncInputFromBuffer();
        }
        return;
      }

      if (trimmedText.startsWith('!')) {
        return;
      }

      return;
    }

    if (key.rightArrow) {
      const buffer = textBufferRef.current;
      const currentText = buffer.getText();
      const cursorAtEnd = getTextBufferCursorOffset(buffer) === currentText.length;

      if (cursorAtEnd) {
        const trimmedText = currentText.trim();
        if (trimmedText.length === 0) {
          const suggestion = suggestionProviderRef.current?.();
          if (suggestion?.trim()) {
            buffer.setText(suggestion);
            syncInputFromBuffer();
            return;
          }
        } else {
          const inlineGhostSuffix = getInlineGhostCompletionSuffix(
            currentText,
            filesProviderRef.current?.() ?? [],
            slashCommandsRef.current ?? [],
            workspaceRootRef.current,
            undefined,
            skillsProviderRef.current,
          );

          if (inlineGhostSuffix) {
            buffer.setText(`${currentText}${inlineGhostSuffix}`);
            syncInputFromBuffer();
            return;
          }
        }
      }
    }

    // ── Toggle shortcut help on '?' when input is empty ──
    if (char === '?' && !key.ctrl && !key.meta && !key.shift) {
      const currentText = textBufferRef.current.getText();
      if (currentText.trim() === '' || currentText.trim() === '?') {
        if (currentText.trim() === '?') {
          textBufferRef.current.setText('');
          syncInputFromBuffer();
        }
        setShowShortcuts(prev => !prev);
        return;
      }
    }

    // ── Auto-hide shortcut help on editable keys ──
    if (showShortcutsRef.current) {
      const isNavigationKey = key.escape || key.tab || key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow;
      const isModifierKey = key.ctrl || key.meta;
      if ((!isNavigationKey && !isModifierKey && char) || key.backspace || key.delete) {
        setShowShortcuts(false);
        // Fall through to process the key normally
      }
    }

    const buffer = textBufferRef.current;
    const result = handleInkTextBufferInput(buffer, char, key);

    if (result === 'submit') {
      const pasteState = pasteStateRef.current;
      
      // Keep the compact paste marker editable in the Composer while resolving
      // it back to the actual pasted text only at submit time.
      let text = resolveInkHiddenPastes(buffer.getText(), pasteState);
      text = text.trim();
      const editingIndex = editingQueueIndexRef.current;

      if (editingIndex !== null) {
        clearInkComposerInputForSubmit(buffer, pasteState, {
          setInput,
          setCursorOffset,
          onInputChange: onInputChangeRef.current,
          clearPendingInputSync: () => {
            pendingInputSyncRef.current = null;
            if (inputSyncTimerRef.current) {
              clearTimeout(inputSyncTimerRef.current);
              inputSyncTimerRef.current = null;
            }
          },
        });
        dismissAutocompleteState();
        queueSelectionIndexRef.current = null;
        editingQueueIndexRef.current = null;
        setQueueSelectionIndex(null);
        setEditingQueueIndex(null);

        if (text.length > 0) {
          onReplaceQueuedInstructionRef.current?.(editingIndex, text);
        } else {
          onRemoveQueuedInstructionRef.current?.(editingIndex);
        }
        return;
      }
      
      if (!text) {
        return;
      }
      clearInkComposerInputForSubmit(buffer, pasteState, {
        setInput,
        setCursorOffset,
        onInputChange: onInputChangeRef.current,
        clearPendingInputSync: () => {
          pendingInputSyncRef.current = null;
          if (inputSyncTimerRef.current) {
            clearTimeout(inputSyncTimerRef.current);
            inputSyncTimerRef.current = null;
          }
        },
      });
      dismissAutocompleteState();
      onInstructionRef.current(text);

      return;
    }

    if (result === 'handled') {
      syncInputFromBuffer();

      // Immediate mention detection so Tab works after rapid typing even
      // before React effects have run the derived suggestion pass.
      const currentText = buffer.getText();
      const currentOffset = getTextBufferCursorOffset(buffer);
      if (currentText.trim() === '') {
        dismissAutocompleteState();
        return;
      }

      const provider = filesProviderRef.current;
      if (provider) {
        const mention = matchFileMention(currentText, currentOffset);
        if (mention) {
          const files = provider();
          const matchingFiles = buildFileMentionSuggestions(files, mention.seed, 5);
          if (matchingFiles.length > 0) {
            fileMentionStartIndexRef.current = mention.startIndex;
            fileMentionSuggestionsRef.current = parseFileSuggestions(matchingFiles);
            fileMentionVisibleRef.current = true;
            setFileMentionSuggestions(fileMentionSuggestionsRef.current);
            setFileMentionVisible(true);
            setFileMentionActiveIndex(prev => Math.min(prev, matchingFiles.length - 1));
          } else {
            fileMentionVisibleRef.current = false;
            fileMentionSuggestionsRef.current = [];
            fileMentionStartIndexRef.current = null;
            setFileMentionVisible(false);
            setFileMentionSuggestions([]);
          }
        } else if (fileMentionVisibleRef.current) {
          fileMentionVisibleRef.current = false;
          fileMentionSuggestionsRef.current = [];
          fileMentionStartIndexRef.current = null;
          setFileMentionVisible(false);
          setFileMentionSuggestions([]);
        }
      }

      // Immediate slash command detection (same pattern as file mentions)
      const cmds = slashCommandsRef.current;
      if (cmds && cmds.length > 0) {
        const trimmed = currentText.replace(/^\s+/, '');
        if (trimmed.startsWith('/')) {
          const subcmdResult = buildSubcommandSuggestions(trimmed, cmds);
          if (subcmdResult !== null) {
            if (subcmdResult.length > 0) {
              const slashMatch = matchSlashCommand(currentText, currentOffset);
              slashStartIndexRef.current = slashMatch?.startIndex ?? 0;
              slashFullMatchRef.current = trimmed;
              slashSuggestionsRef.current = subcmdResult;
              slashVisibleRef.current = true;
              setSlashSuggestions(subcmdResult);
              setSlashVisible(true);
              setSlashActiveIndex(prev => Math.min(prev, subcmdResult.length - 1));
            } else {
              slashVisibleRef.current = false;
              slashSuggestionsRef.current = [];
              setSlashVisible(false);
              setSlashSuggestions([]);
            }
          } else {
            const slashMatch = matchSlashCommand(currentText, currentOffset);
            if (slashMatch) {
              const slashSuggs = buildSlashSuggestions(slashMatch.seed, cmds);
              if (slashSuggs.length > 0) {
                slashStartIndexRef.current = slashMatch.startIndex;
                slashFullMatchRef.current = currentText.slice(slashMatch.startIndex);
                slashSuggestionsRef.current = slashSuggs;
                slashVisibleRef.current = true;
                setSlashSuggestions(slashSuggs);
                setSlashVisible(true);
                setSlashActiveIndex(prev => Math.min(prev, slashSuggs.length - 1));
              } else if (slashVisibleRef.current) {
                slashVisibleRef.current = false;
                slashSuggestionsRef.current = [];
                slashStartIndexRef.current = null;
                slashFullMatchRef.current = null;
                setSlashVisible(false);
                setSlashSuggestions([]);
              }
            } else if (slashVisibleRef.current) {
              slashVisibleRef.current = false;
              slashSuggestionsRef.current = [];
              slashStartIndexRef.current = null;
              slashFullMatchRef.current = null;
              setSlashVisible(false);
              setSlashSuggestions([]);
            }
          }
        } else if (slashVisibleRef.current) {
          slashVisibleRef.current = false;
          slashSuggestionsRef.current = [];
          slashStartIndexRef.current = null;
          slashFullMatchRef.current = null;
          setSlashVisible(false);
          setSlashSuggestions([]);
        }
      }

      const skillProvider = skillsProviderRef.current;
      if (skillProvider) {
        const skillMention = matchSkillMention(currentText, currentOffset);
        if (skillMention) {
          const skillSuggs = buildSkillSuggestions(skillMention.seed, skillProvider());
          if (skillSuggs.length > 0) {
            skillStartIndexRef.current = skillMention.startIndex;
            skillSuggestionsRef.current = skillSuggs;
            skillVisibleRef.current = true;
            skillActiveIndexRef.current = Math.min(skillActiveIndexRef.current, skillSuggs.length - 1);
            setSkillSuggestions(skillSuggs);
            setSkillVisible(true);
            setSkillActiveIndex(prev => Math.min(prev, skillSuggs.length - 1));
          } else {
            skillVisibleRef.current = false;
            skillSuggestionsRef.current = [];
            skillStartIndexRef.current = null;
            setSkillVisible(false);
            setSkillSuggestions([]);
          }
        } else if (skillVisibleRef.current) {
          skillVisibleRef.current = false;
          skillSuggestionsRef.current = [];
          skillStartIndexRef.current = null;
          setSkillVisible(false);
          setSkillSuggestions([]);
        }
      }
      return;
    }
  }, [syncBufferViewport, syncInputFromBuffer, dismissAutocompleteState, acceptActiveAutocompleteSuggestion, insertPastedText]);

  // Extra safety: wrap in a ref so useInput never re-registers even if
  // the above callback identity changes unexpectedly.
  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;
  const stableHandleInput = useCallback((char: string, key: InkKey) => {
    handleInputRef.current(char, key);
  }, []);

  useInput(stableHandleInput);

  // Memoize tool outputs to prevent unnecessary re-renders
  // Static items use the entry id as key and never re-render
  const toolOutputItems = useMemo(() =>
    state.toolOutputs.slice(-50), // Limit to last 50 for performance
    [state.toolOutputs]
  );
  const liveCommandItems = useMemo(() =>
    state.liveCommands.slice(-3),
    [state.liveCommands]
  );

  // Calculate input width from a resize-aware hook.
  // With synchronized-output patching (InkRenderer), rapid resize re-renders
  // are batched atomically, so the old 100ms debounce is no longer needed
  // and was actually causing a layout lag during drag-resize.
  const windowSize = useTerminalWindowSize();
  const inputWidth = getPromptBlockWidth(windowSize.columns);
  const composerNextPromptSuggestion = useMemo(() => {
    if (
      state.isWorking ||
      input.trim().length > 0 ||
      slashVisible ||
      fileMentionVisible ||
      skillVisible
    ) {
      return undefined;
    }
    const suggestion = suggestionProvider?.();
    if (!suggestion?.trim()) {
      return undefined;
    }
    if (matchesCurrentAssistantResponseSuggestion(suggestion, state)) {
      return undefined;
    }
    return suggestion;
  }, [
    input,
    suggestionProvider,
    state.finalResponse,
    state.chatMessages,
    state.suggestionRefreshId,
    state.isWorking,
    slashVisible,
    fileMentionVisible,
    skillVisible,
  ]);
  const composerInlineGhostSuffix = useMemo(() => {
    if (!input || input.includes('\n')) {
      return undefined;
    }
    if (input.trimStart().startsWith('!')) {
      return undefined;
    }
    return getInlineGhostCompletionSuffix(
      input,
      filesProvider?.() ?? [],
      slashCommands ?? [],
      workspaceRoot,
      undefined,
      skillsProvider,
    ) ?? undefined;
  }, [
    input,
    filesProvider,
    slashCommands,
    workspaceRoot,
    skillsProvider,
    state.suggestionRefreshId,
  ]);
  const chatHistoryItems = useMemo<ChatHistoryItem[]>(() => {
    const sourceMessages = state.chatMessages.length > 0
      ? state.chatMessages
      : state.userMessages.map((content): ChatLogMessage => ({ role: 'user', content }));

    return sourceMessages
      .filter((message) => message.role !== 'notification')
      .map((message, index) => ({ index, message }));
  }, [state.chatMessages, state.userMessages]);
  const staticChatMessageOffset = Math.min(
    Math.max(0, state.staticChatMessageOffset),
    chatHistoryItems.length
  );
  const staticChatHistoryItems = useMemo(
    () => chatHistoryItems.slice(staticChatMessageOffset),
    [chatHistoryItems, staticChatMessageOffset]
  );
  const chatIncludesToolOutput = useMemo(() =>
    state.chatMessages.some((message) => message.role === 'tool'),
    [state.chatMessages]
  );
  const chatIncludesFinalResponse = useMemo(() => {
    const finalResponse = state.finalResponse?.trim();
    if (!finalResponse || state.isWorking) {
      return false;
    }
    return state.chatMessages.some((message) =>
      message.role === 'assistant' && message.content === finalResponse
    );
  }, [state.chatMessages, state.finalResponse, state.isWorking]);
  const chatIncludesCompletion = useMemo(() =>
    state.chatMessages.some((message) => message.role === 'completion'),
    [state.chatMessages]
  );

  // Compute border style to match readline/terminal regions behavior
  const inputBorderStyle: InputBorderStyle = (() => {
    if (/^[\s\u200B-\u200D\uFEFF]*!/u.test(input)) {
      return 'shell';
    }
    if (getPlanModeManager().isEnabled()) {
      return 'plan';
    }
    return 'default';
  })();
  const effectiveLineExtensions = state.lineExtensions ?? lineExtensions;
  const effectiveConfiguredLineExtensions = state.configuredLineExtensions;

  return (
    <Box flexDirection="column">
      {/* Plan mode indicator */}
      {planModeIndicator && planModeStatusKey && (
        <Box>
          <Text color={colors.accent} bold>{planModeIndicator}</Text>
          <Text color={colors.muted}> {t(planModeStatusKey)}</Text>
        </Box>
      )}

      {liveCommandItems.map((item) => (
        <LiveCommandBlock key={item.id} entry={item} />
      ))}

      <Static items={staticChatHistoryItems}>
        {({ message, index }) => (
          <ChatHistoryMessage key={`chat-${index}`} message={message} index={index} />
        )}
      </Static>

      {/* Tool outputs - rendered dynamically so Ink manages them during resize.
          Components are memoized so React skips execution when data is unchanged. */}
      {!chatIncludesToolOutput && toolOutputItems.map((item: ToolOutputItem) => (
        item.type === 'batch'
          ? <ToolOutputBatchStatic key={item.id} entry={item as ToolOutputBatchEntry} />
          : <ToolOutputStatic key={item.id} entry={item as ToolOutputEntry} />
      ))}

      {/* Dynamic content section */}
      <DynamicContent
        thinking={state.thinking}
        finalResponse={chatIncludesFinalResponse ? null : state.finalResponse}
        isWorking={state.isWorking}
      />

      <NotificationStack notifications={state.notifications} />

      {/* Fixed bottom section - always renders for layout stability */}
      <FixedBottom
        isWorking={state.isWorking}
        status={state.status}
        elapsed={state.elapsed}
        tokens={state.tokens}
        queuedInstructions={state.queuedInstructions}
        selectedQueueIndex={queueSelectionIndex}
        completionStats={chatIncludesCompletion ? null : state.completionStats}
        enableQueueInput={enableQueueInput}
        input={input}
        cursorOffset={cursorOffset}
        ctrlCCount={ctrlCCount}
        contextPercent={state.contextPercent}
        contextTokens={state.contextTokens}
        provider={state.provider}
        model={state.model}
        lineExtensions={effectiveLineExtensions}
        configuredLineExtensions={effectiveConfiguredLineExtensions}
        fileMentionDropdown={
          <FileMentionDropdown
            suggestions={fileMentionSuggestions}
            activeIndex={fileMentionActiveIndex}
            visible={fileMentionVisible && !state.isWorking}
          />
        }
        skillMentionDropdown={
          <SkillMentionDropdown
            suggestions={skillSuggestions}
            activeIndex={skillActiveIndex}
            visible={skillVisible && !state.isWorking}
          />
        }
        slashCommandDropdown={
          <SlashCommandDropdown
            suggestions={slashSuggestions}
            activeIndex={slashActiveIndex}
            visible={slashVisible && enableQueueInput}
          />
        }
        inputWidth={inputWidth}
        borderStyle={inputBorderStyle}
        nextPromptSuggestion={composerNextPromptSuggestion}
        inlineGhostSuffix={composerInlineGhostSuffix}
        showShortcuts={showShortcuts}
      />
    </Box>
  );
}

/**
 * Memoized dynamic content (thinking, final response)
 */
interface DynamicContentProps {
  thinking: string | null;
  finalResponse: string | null;
  isWorking: boolean;
}

const DynamicContent = memo(function DynamicContent({
  thinking,
  finalResponse,
  isWorking
}: DynamicContentProps) {
  // Parse final response to detect SITREP sections
  const content = useMemo(() => {
    if (!finalResponse || isWorking) return null;

    // Check if this contains a SITREP block
    const sitrepMatch = finalResponse.match(/SITREP:\s*\n([\s\S]*?)(?=\n\n|$)/);
    if (sitrepMatch) {
      const sitrepText = sitrepMatch[0];
      const sitrepProps = parseSitrepText(sitrepText);
      const beforeSitrep = finalResponse.slice(0, sitrepMatch.index).trim();
      const afterSitrep = finalResponse.slice(sitrepMatch.index! + sitrepText.length).trim();

      return {
        before: beforeSitrep || null,
        sitrep: sitrepProps,
        after: afterSitrep || null
      };
    }

    // No SITREP, return plain text
    return { before: finalResponse, sitrep: null, after: null };
  }, [finalResponse, isWorking]);

  return (
    <>
      {/* Thinking output */}
      <ThinkingOutput thought={isWorking ? thinking : null} />

      {/* Final response (when not working) */}
      {content && (
        <>
          {content.before && (
            <Box marginTop={1}>
              <MarkdownDiffContent content={content.before} />
            </Box>
          )}
          {content.sitrep && (
            <SitrepMessage
              done={content.sitrep.done}
              files={content.sitrep.files}
              status={content.sitrep.status}
              next={content.sitrep.next}
              verify={content.sitrep.verify}
            />
          )}
          {content.after && (
            <Box marginTop={1}>
              <MarkdownDiffContent content={content.after} />
            </Box>
          )}
        </>
      )}
    </>
  );
}, (prev, next) => {
  return prev.thinking === next.thinking &&
         prev.finalResponse === next.finalResponse &&
         prev.isWorking === next.isWorking;
});

const ChatHistoryMessage = memo(function ChatHistoryMessage({
  message,
  index,
}: {
  message: ChatLogMessage;
  index: number;
}) {
  if (message.role === 'user') {
    return (
      <UserMessage>
        {message.content}
      </UserMessage>
    );
  }

  if (message.role === 'tool') {
    return (
      <ToolOutputStatic
        entry={{
          id: `chat-tool-${index}`,
          tool: message.tool ?? 'tool',
          success: message.success ?? true,
          output: message.content,
          timestamp: index,
        }}
      />
    );
  }

  if (message.role === 'tool_call') {
    return <ToolCallHistoryMessage tool={message.tool ?? 'tool'} detail={message.content} />;
  }

  if (message.role === 'completion') {
    return <CompletionHistoryMessage content={message.content} />;
  }

  if (message.role === 'notification') {
    return <NotificationHistoryMessage content={message.content} />;
  }

  return (
    <Box marginTop={1}>
      <MarkdownDiffContent content={message.content} />
    </Box>
  );
});

const ToolCallHistoryMessage = memo(function ToolCallHistoryMessage({
  tool,
  detail,
}: {
  tool: string;
  detail: string;
}) {
  const { colors } = useTheme();

  return (
    <Box marginBottom={1}>
      <Text color={colors.accent}>⠋</Text>
      <Text bold> {tool}</Text>
      {detail ? <Text color={colors.muted}> {detail}</Text> : null}
    </Box>
  );
});

const MarkdownDiffContent = memo(function MarkdownDiffContent({
  content,
}: {
  content: string;
}) {
  const segments = useMemo(() => splitMarkdownDiffFences(content), [content]);

  return (
    <Box flexDirection="column">
      {segments.map((segment, index) => (
        segment.type === 'diff'
          ? <ThemedDiffOutput key={`diff-${index}`} output={segment.content} />
          : (
            <Text key={`text-${index}`}>
              {renderTerminalMarkdown(segment.content.trim())}
            </Text>
          )
      ))}
    </Box>
  );
});

const NotificationHistoryMessage = memo(function NotificationHistoryMessage({
  content,
}: {
  content: string;
}) {
  const { colors } = useTheme();
  return (
    <Box marginTop={1}>
      <Text color={colors.warning}>{content}</Text>
    </Box>
  );
});

const NotificationStack = memo(function NotificationStack({
  notifications,
}: {
  notifications: string[];
}) {
  const recentNotifications = notifications.slice(-3);
  if (recentNotifications.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {recentNotifications.map((content, index) => (
        <NotificationHistoryMessage key={`${index}-${content}`} content={content} />
      ))}
    </Box>
  );
}, (prev, next) => prev.notifications === next.notifications);

const CompletionHistoryMessage = memo(function CompletionHistoryMessage({
  content,
}: {
  content: string;
}) {
  const { colors } = useTheme();
  return (
    <Box marginTop={1}>
      <Text color={colors.muted}>{content}</Text>
    </Box>
  );
});

/**
 * Status section - status line, queue, completion stats
 * Memoized to prevent re-renders when only input changes
 */
interface StatusSectionProps {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  queuedInstructions: string[];
  selectedQueueIndex: number | null;
  completionStats: { elapsed: string; tokens: string; status?: TurnCompletionStatus } | null;
  contextPercent?: number;
  contextTokens?: ContextTokenDisplay;
  provider?: string;
  model?: string;
  lineExtension?: LineExtension;
}

interface QueuedInstructionsPanelProps {
  queuedInstructions: string[];
  selectedQueueIndex: number | null;
}

function formatQueuedInstructionRow(instruction: string, width: number): string {
  const singleLine = instruction.replace(/\s+/g, ' ').trim();
  const maxLength = Math.max(20, width - 8);
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

const QueuedInstructionsPanel = memo(function QueuedInstructionsPanel({
  queuedInstructions,
  selectedQueueIndex,
}: QueuedInstructionsPanelProps) {
  const { colors } = useTheme();
  const windowSize = useTerminalWindowSize();
  const width = getPromptBlockWidth(windowSize.columns);
  const focused = selectedQueueIndex !== null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={colors.muted} bold>
        Queue · {queuedInstructions.length} pending
      </Text>
      {queuedInstructions.map((instruction, idx) => {
        const selected = selectedQueueIndex === idx;
        const prefix = selected ? '›' : ' ';
        return (
          <Box key={`${idx}:${instruction}`}>
            <Text color={selected ? colors.accent : colors.muted} bold={selected}>
              {prefix} {idx + 1}. {formatQueuedInstructionRow(instruction, width)}
            </Text>
          </Box>
        );
      })}
      {focused && (
        <Text color={colors.muted}>
          enter edit · delete remove · esc clear selection
        </Text>
      )}
    </Box>
  );
}, (prev, next) => (
  prev.queuedInstructions === next.queuedInstructions &&
  prev.selectedQueueIndex === next.selectedQueueIndex
));

const StatusSection = memo(function StatusSection({
  isWorking,
  status,
  elapsed,
  tokens,
  queuedInstructions,
  selectedQueueIndex,
  completionStats,
  contextPercent,
  contextTokens,
  provider,
  model,
  lineExtension,
}: StatusSectionProps) {
  const { colors } = useTheme();

  // Show queue or completion stats in a stable position
  const showQueue = queuedInstructions.length > 0 && isWorking;
  const showCompletionStats = !isWorking && completionStats;

  return (
    <>
      {/* Status line with spinner - always renders for stability */}
      <StatusLine
        isWorking={isWorking}
        status={status}
        elapsed={elapsed}
        tokens={tokens}
        queueCount={queuedInstructions.length}
        contextPercent={contextPercent}
        contextTokens={contextTokens}
        provider={provider}
        model={model}
        lineExtension={lineExtension}
      />

      {/* Info section - either queue or completion stats, stable position */}
      {showQueue && (
        <QueuedInstructionsPanel
          queuedInstructions={queuedInstructions}
          selectedQueueIndex={selectedQueueIndex}
        />
      )}
      {showCompletionStats && (
        <Box marginTop={1}>
          <Text color={colors.muted}>
            {completionStats.status === 'failed' ? 'Failed' : 'Completed'} in {completionStats.elapsed} · {completionStats.tokens}
          </Text>
        </Box>
      )}
    </>
  );
}, (prev, next) => {
  // Only re-render if status-related props change
  return prev.isWorking === next.isWorking &&
         prev.status === next.status &&
         prev.elapsed === next.elapsed &&
         prev.tokens === next.tokens &&
         prev.contextPercent === next.contextPercent &&
         prev.contextTokens?.used === next.contextTokens?.used &&
         prev.contextTokens?.total === next.contextTokens?.total &&
         prev.queuedInstructions === next.queuedInstructions &&
         prev.selectedQueueIndex === next.selectedQueueIndex &&
         prev.completionStats?.elapsed === next.completionStats?.elapsed &&
         prev.completionStats?.tokens === next.completionStats?.tokens &&
         prev.completionStats?.status === next.completionStats?.status &&
         prev.provider === next.provider &&
         prev.model === next.model &&
         prev.lineExtension === next.lineExtension;
});

/**
 * Input line wrapper - only re-renders when input props change
 * Separated from help line to prevent resize flicker
 */
interface InputLineWrapperProps {
  isWorking: boolean;
  enableQueueInput: boolean;
  input: string;
  cursorOffset: number;
  /** Terminal width for InputLine */
  inputWidth: number;
  /** Border style for the input box */
  borderStyle?: InputBorderStyle;
  placeholderText?: string;
  nextPromptSuggestion?: string;
  inlineGhostSuffix?: string;
  enableHardwareCursor?: boolean;
}

const InputLineWrapper = memo(function InputLineWrapper({
  isWorking,
  enableQueueInput,
  input,
  cursorOffset,
  inputWidth,
  borderStyle,
  placeholderText,
  nextPromptSuggestion,
  inlineGhostSuffix,
  enableHardwareCursor,
}: InputLineWrapperProps) {
  if (!enableQueueInput) {
    return null;
  }

  return (
    <InputLine
      value={input}
      cursorOffset={cursorOffset}
      isActive={true}
      width={inputWidth}
      borderStyle={borderStyle}
      placeholderText={placeholderText}
      nextPromptSuggestion={nextPromptSuggestion}
      inlineGhostSuffix={inlineGhostSuffix}
      enableHardwareCursor={enableHardwareCursor}
    />
  );
}, (prev, next) => {
  return prev.isWorking === next.isWorking &&
         prev.enableQueueInput === next.enableQueueInput &&
         prev.input === next.input &&
         prev.cursorOffset === next.cursorOffset &&
         prev.inputWidth === next.inputWidth &&
         prev.borderStyle === next.borderStyle &&
         prev.placeholderText === next.placeholderText &&
         prev.nextPromptSuggestion === next.nextPromptSuggestion &&
         prev.inlineGhostSuffix === next.inlineGhostSuffix &&
         prev.enableHardwareCursor === next.enableHardwareCursor;
});

/**
 * Help line section - shows context info and command hints
 * Memoized separately from InputLine to prevent resize flicker
 */
interface HelpLineSectionProps {
  isWorking: boolean;
  contextPercent?: number;
  contextTokens?: ContextTokenDisplay;
  provider?: string;
  model?: string;
  lineExtension?: LineExtension;
}

const HelpLineSection = memo(function HelpLineSection({
  isWorking,
  contextPercent,
  contextTokens,
  provider,
  model,
  lineExtension,
}: HelpLineSectionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Format context usage.
  const contextDisplay = contextTokens !== undefined
    ? contextTokens
    : contextPercent !== undefined
    ? `${Math.round(contextPercent)}% context left`
    : '';

  // Format provider/model display
  const providerDisplay = provider
    ? `autohand (${t(`providers.${provider}`) ?? provider}${model ? `, ${model}` : ''})`
    : '';

  return (
    <Box>
      <Text color={colors.dim}>
        {getComposerHelpLine(isWorking, providerDisplay, contextDisplay, t('ui.commandHint'), lineExtension)}
      </Text>
    </Box>
  );
}, (prev, next) => {
  return prev.isWorking === next.isWorking &&
         prev.contextPercent === next.contextPercent &&
         prev.contextTokens?.used === next.contextTokens?.used &&
         prev.contextTokens?.total === next.contextTokens?.total &&
         prev.provider === next.provider &&
         prev.model === next.model &&
         prev.lineExtension === next.lineExtension;
});

/**
 * Ctrl+C warning section
 */
interface CtrlCWarningProps {
  ctrlCCount: number;
}

const CtrlCWarning = memo(function CtrlCWarning({
  ctrlCCount,
}: CtrlCWarningProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  if (ctrlCCount !== 1) {
    return null;
  }

  return (
    <Box>
      <Text color={colors.warning}>{t('ui.ctrlCToExit')}</Text>
    </Box>
  );
}, (prev, next) => {
  return prev.ctrlCCount === next.ctrlCCount;
});

const FooterClearance = memo(function FooterClearance() {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text> </Text>
      <Text> </Text>
    </Box>
  );
});

/**
 * File mention dropdown wrapper
 */
interface FileMentionWrapperProps {
  fileMentionDropdown?: React.ReactNode;
}

const FileMentionWrapper = memo(function FileMentionWrapper({
  fileMentionDropdown,
}: FileMentionWrapperProps) {
  return fileMentionDropdown ?? null;
}, (prev, next) => {
  return prev.fileMentionDropdown === next.fileMentionDropdown;
});

/**
 * Slash command dropdown wrapper
 */
interface SlashCommandWrapperProps {
  slashCommandDropdown?: React.ReactNode;
}

const SlashCommandWrapper = memo(function SlashCommandWrapper({
  slashCommandDropdown,
}: SlashCommandWrapperProps) {
  return slashCommandDropdown ?? null;
}, (prev, next) => {
  return prev.slashCommandDropdown === next.slashCommandDropdown;
});

/**
 * Skill mention dropdown wrapper
 */
interface SkillMentionWrapperProps {
  skillMentionDropdown?: React.ReactNode;
}

const SkillMentionWrapper = memo(function SkillMentionWrapper({
  skillMentionDropdown,
}: SkillMentionWrapperProps) {
  return skillMentionDropdown ?? null;
}, (prev, next) => {
  return prev.skillMentionDropdown === next.skillMentionDropdown;
});

/**
 * Fixed bottom section - status line, queue, input
 * Split into StatusSection and InputSection for better memoization
 */
interface FixedBottomProps {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  queuedInstructions: string[];
  selectedQueueIndex: number | null;
  completionStats: { elapsed: string; tokens: string; status?: TurnCompletionStatus } | null;
  enableQueueInput: boolean;
  input: string;
  cursorOffset: number;
  ctrlCCount: number;
  contextPercent?: number;
  contextTokens?: ContextTokenDisplay;
  provider?: string;
  model?: string;
  lineExtensions?: AgentUILineExtensions;
  configuredLineExtensions?: AgentUILineExtensions;
  fileMentionDropdown?: React.ReactNode;
  slashCommandDropdown?: React.ReactNode;
  skillMentionDropdown?: React.ReactNode;
  /** Terminal width for InputLine */
  inputWidth: number;
  /** Border style for the input box */
  borderStyle?: InputBorderStyle;
  placeholderText?: string;
  nextPromptSuggestion?: string;
  inlineGhostSuffix?: string;
  /** Whether the shortcuts help panel is visible */
  showShortcuts: boolean;
}

const FixedBottom = memo(function FixedBottom({
  isWorking,
  status,
  elapsed,
  tokens,
  queuedInstructions,
  selectedQueueIndex,
  completionStats,
  enableQueueInput,
  input,
  cursorOffset,
  ctrlCCount,
  contextPercent,
  contextTokens,
  provider,
  model,
  lineExtensions,
  configuredLineExtensions,
  fileMentionDropdown,
  slashCommandDropdown,
  skillMentionDropdown,
  inputWidth,
  borderStyle,
  placeholderText,
  nextPromptSuggestion,
  inlineGhostSuffix,
  showShortcuts,
}: FixedBottomProps) {
  return (
    <>
      <StatusSection
        isWorking={isWorking}
        status={status}
        elapsed={elapsed}
        tokens={tokens}
        queuedInstructions={queuedInstructions}
        selectedQueueIndex={selectedQueueIndex}
        completionStats={completionStats}
        contextPercent={contextPercent}
        contextTokens={contextTokens}
        provider={provider}
        model={model}
        lineExtension={mergeLineExtensions(configuredLineExtensions?.status, lineExtensions?.status)}
      />
      <InputLineWrapper
        isWorking={isWorking}
        enableQueueInput={enableQueueInput}
        input={input}
        cursorOffset={cursorOffset}
        inputWidth={inputWidth}
        borderStyle={borderStyle}
        placeholderText={placeholderText}
        nextPromptSuggestion={nextPromptSuggestion}
        inlineGhostSuffix={inlineGhostSuffix}
        enableHardwareCursor={!isWorking || input.length > 0}
      />
      <FileMentionWrapper fileMentionDropdown={fileMentionDropdown} />
      <SlashCommandWrapper slashCommandDropdown={slashCommandDropdown} />
      <SkillMentionWrapper skillMentionDropdown={skillMentionDropdown} />
      <ShortcutsHelpPanel visible={showShortcuts && !isWorking} />
      <HelpLineSection
        isWorking={isWorking}
        contextPercent={contextPercent}
        contextTokens={contextTokens}
        provider={provider}
        model={model}
        lineExtension={mergeLineExtensions(configuredLineExtensions?.help, lineExtensions?.help)}
      />
      <CtrlCWarning ctrlCCount={ctrlCCount} />
      <FooterClearance />
    </>
  );
});

/**
 * Create initial UI state
 */
export function createInitialUIState(): AgentUIState {
  return {
    isWorking: false,
    status: '',
    elapsed: '',
    tokens: '',
    toolOutputs: [],
    liveCommands: [],
    thinking: null,
    queuedInstructions: [],
    userMessages: [],
    chatMessages: [],
    notifications: [],
    staticChatMessageOffset: 0,
    currentInput: '',
    finalResponse: null,
    completionStats: null,
    // Default to 100% before any tokens are consumed so the welcome helpline
    // shows "100% context left" right after startup, before the first prompt.
    contextPercent: 100,
    contextTokens: undefined,
    provider: undefined,
    model: undefined,
    lineExtensions: undefined,
    configuredLineExtensions: undefined,
  };
}
