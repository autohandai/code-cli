/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, memo, useMemo, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp, Static, type Key as InkKey } from 'ink';
import { StatusLine } from './StatusLine.js';
import { ToolOutputStatic, ToolOutputBatchStatic, type ToolOutputEntry, type ToolOutputBatchEntry, type ToolOutputItem } from './ToolOutput.js';
import { InputLine } from './InputLine.js';
import { ThinkingOutput } from './ThinkingOutput.js';
import { useTheme } from '../theme/ThemeContext.js';
import { useTranslation } from '../i18n/index.js';
import { getPlanModeManager } from '../../commands/plan.js';
import { TextBuffer } from '../textBuffer.js';
import { handleTextBufferKey, type KeyHandlerResult } from '../textBufferKeyHandler.js';
import { getPromptBlockWidth, isShiftEnterResidualSequence } from '../inputPrompt.js';
import { renderTerminalMarkdown } from '../../core/immediateCommandRouter.js';

export interface AgentUIState {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  toolOutputs: ToolOutputItem[];
  thinking: string | null;
  queuedInstructions: string[];
  currentInput: string;
  finalResponse: string | null;
  /** Completion stats shown after work finishes */
  completionStats: { elapsed: string; tokens: string } | null;
  /** Plan mode indicator (e.g., '[PLAN]' or '[EXEC]') */
  planModeIndicator?: string;
  /** Context percentage remaining (0-100) */
  contextPercent?: number;
}

export interface AgentUIProps {
  state: AgentUIState;
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  onInputChange?: (input: string) => void;
  enableQueueInput?: boolean;
}

interface TextBufferKeyInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

const INK_TEXTBUFFER_VIEWPORT_HEIGHT = 10;

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
  } else if (key.delete) {
    name = 'delete';
  } else if (key.tab) {
    name = 'tab';
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

export function handleInkTextBufferInput(
  buffer: TextBuffer,
  input: string,
  key: InkKey
): KeyHandlerResult {
  if (isShiftEnterResidualSequence(input)) {
    buffer.insert('\n');
    return 'handled';
  }

  return handleTextBufferKey(buffer, input, mapInkKeyToTextBufferKey(input, key));
}

export function getComposerHelpLine(
  isWorking: boolean,
  contextDisplay: string,
  commandHint: string
): string {
  if (isWorking) {
    return ' ';
  }

  return `${contextDisplay}${contextDisplay ? ' · ' : ''}${commandHint}`;
}

export function AgentUI({
  state,
  onInstruction,
  onEscape,
  onCtrlC,
  onInputChange,
  enableQueueInput = true
}: AgentUIProps) {
  const { exit } = useApp();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [input, setInput] = useState(state.currentInput || '');
  const [cursorOffset, setCursorOffset] = useState((state.currentInput || '').length);
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [planModeIndicator, setPlanModeIndicator] = useState('');
  const [planModeStatusKey, setPlanModeStatusKey] = useState('');
  const textBufferRef = useRef<TextBuffer>(
    new TextBuffer(
      getInkTextBufferViewportWidth(process.stdout.columns),
      INK_TEXTBUFFER_VIEWPORT_HEIGHT,
      state.currentInput || undefined
    )
  );

  const syncInputFromBuffer = useCallback(() => {
    const buffer = textBufferRef.current;
    setInput(buffer.getText());
    setCursorOffset(getTextBufferCursorOffset(buffer));
  }, []);

  const syncBufferViewport = useCallback(() => {
    textBufferRef.current.setViewport(
      getInkTextBufferViewportWidth(process.stdout.columns),
      INK_TEXTBUFFER_VIEWPORT_HEIGHT
    );
  }, []);

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

  useEffect(() => {
    syncBufferViewport();
  });

  useEffect(() => {
    const buffer = textBufferRef.current;
    if (state.currentInput !== buffer.getText()) {
      buffer.setText(state.currentInput || '');
      syncInputFromBuffer();
    }
  }, [state.currentInput, syncInputFromBuffer]);

  // Reset ctrl+c count after 2 seconds
  useEffect(() => {
    if (ctrlCCount > 0) {
      const timer = setTimeout(() => setCtrlCCount(0), 2000);
      return () => clearTimeout(timer);
    }
  }, [ctrlCCount]);

  useInput((char, key) => {
    syncBufferViewport();

    // Handle Shift+Tab for plan mode toggle
    if (key.tab && key.shift) {
      const planModeManager = getPlanModeManager();
      planModeManager.handleShiftTab();
      return;
    }

    // Handle escape - cancel current operation
    if (key.escape) {
      onEscape();
      return;
    }

    // Handle Ctrl+C - first warns, second exits
    if (key.ctrl && char === 'c') {
      if (ctrlCCount === 0) {
        setCtrlCCount(1);
        onCtrlC();
      } else {
        exit();
      }
      return;
    }

    // Only handle input when working and queue input is enabled
    if (!state.isWorking || !enableQueueInput) {
      return;
    }

    if (key.tab) {
      return;
    }

    const buffer = textBufferRef.current;
    const result = handleInkTextBufferInput(buffer, char, key);

    if (result === 'submit') {
      const text = buffer.getText().trim();
      if (!text) {
        return;
      }
      onInstruction(text);
      buffer.setText('');
      syncInputFromBuffer();
      return;
    }

    if (result === 'handled') {
      syncInputFromBuffer();
      return;
    }
  });

  // Memoize tool outputs to prevent unnecessary re-renders
  // Static items use the entry id as key and never re-render
  const toolOutputItems = useMemo(() =>
    state.toolOutputs.slice(-50), // Limit to last 50 for performance
    [state.toolOutputs]
  );

  return (
    <Box flexDirection="column">
      {/* Plan mode indicator */}
      {planModeIndicator && planModeStatusKey && (
        <Box>
          <Text color="cyan" bold>{planModeIndicator}</Text>
          <Text color={colors.muted}> {t(planModeStatusKey)}</Text>
        </Box>
      )}

      {/* Static tool outputs - these never re-render once displayed */}
      <Static items={toolOutputItems}>
        {(item: ToolOutputItem) => (
          item.type === 'batch'
            ? <ToolOutputBatchStatic key={item.id} entry={item as ToolOutputBatchEntry} />
            : <ToolOutputStatic key={item.id} entry={item as ToolOutputEntry} />
        )}
      </Static>

      {/* Dynamic content section */}
      <DynamicContent
        thinking={state.thinking}
        finalResponse={state.finalResponse}
        isWorking={state.isWorking}
      />

      {/* Fixed bottom section - always renders for layout stability */}
      <FixedBottom
        isWorking={state.isWorking}
        status={state.status}
        elapsed={state.elapsed}
        tokens={state.tokens}
        queuedInstructions={state.queuedInstructions}
        completionStats={state.completionStats}
        enableQueueInput={enableQueueInput}
        input={input}
        cursorOffset={cursorOffset}
        ctrlCCount={ctrlCCount}
        contextPercent={state.contextPercent}
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
  return (
    <>
      {/* Thinking output */}
      <ThinkingOutput thought={thinking} />

      {/* Final response (when not working) */}
      {finalResponse && !isWorking && (
        <Box marginTop={1}>
          <Text>{renderTerminalMarkdown(finalResponse)}</Text>
        </Box>
      )}
    </>
  );
}, (prev, next) => {
  return prev.thinking === next.thinking &&
         prev.finalResponse === next.finalResponse &&
         prev.isWorking === next.isWorking;
});

/**
 * Fixed bottom section - status line, queue, input
 */
interface FixedBottomProps {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  queuedInstructions: string[];
  completionStats: { elapsed: string; tokens: string } | null;
  enableQueueInput: boolean;
  input: string;
  cursorOffset: number;
  ctrlCCount: number;
  contextPercent?: number;
}

const FixedBottom = memo(function FixedBottom({
  isWorking,
  status,
  elapsed,
  tokens,
  queuedInstructions,
  completionStats,
  enableQueueInput,
  input,
  cursorOffset,
  ctrlCCount,
  contextPercent
}: FixedBottomProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Show queue or completion stats in a stable position
  const showQueue = queuedInstructions.length > 0 && isWorking;
  const showCompletionStats = !isWorking && completionStats;

  // Format context percentage
  const contextDisplay = contextPercent !== undefined
    ? `${Math.round(contextPercent)}% context left`
    : '';

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
      />

      {/* Info section - either queue or completion stats, stable position */}
      {showQueue && (
        <Box flexDirection="column" marginTop={1}>
          {queuedInstructions.map((instruction, idx) => (
            <Box key={idx}>
              <Text color={colors.muted} italic>
                (queued) - {instruction.length > 60 ? instruction.slice(0, 57) + '...' : instruction}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {showCompletionStats && (
        <Box marginTop={1}>
          <Text color={colors.muted}>
            Completed in {completionStats.elapsed} · {completionStats.tokens}
          </Text>
        </Box>
      )}

      {/* Input line - always rendered for layout stability */}
      {enableQueueInput && (
        <InputLine
          value={input}
          cursorOffset={cursorOffset}
          isActive={isWorking}
        />
      )}

      {/* Help line - reserve a stable row even while working to avoid first-send layout jumps */}
      <Box>
        <Text color={colors.dim}>
          {getComposerHelpLine(isWorking, contextDisplay, t('ui.commandHint'))}
        </Text>
      </Box>

      {/* Ctrl+C warning - renders in stable position */}
      {ctrlCCount === 1 && (
        <Box>
          <Text color={colors.warning}>{t('ui.ctrlCToExit')}</Text>
        </Box>
      )}
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
    thinking: null,
    queuedInstructions: [],
    currentInput: '',
    finalResponse: null,
    completionStats: null,
    contextPercent: undefined
  };
}
