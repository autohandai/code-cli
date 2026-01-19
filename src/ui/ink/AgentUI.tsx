/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, memo, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import { StatusLine } from './StatusLine.js';
import { ToolOutputStatic, type ToolOutputEntry } from './ToolOutput.js';
import { InputLine } from './InputLine.js';
import { ThinkingOutput } from './ThinkingOutput.js';
import { useTheme } from '../theme/ThemeContext.js';
import { getPlanModeManager } from '../../commands/plan.js';

export interface AgentUIState {
  isWorking: boolean;
  status: string;
  elapsed: string;
  tokens: string;
  toolOutputs: ToolOutputEntry[];
  thinking: string | null;
  queuedInstructions: string[];
  currentInput: string;
  finalResponse: string | null;
  /** Completion stats shown after work finishes */
  completionStats: { elapsed: string; tokens: string } | null;
  /** Plan mode indicator (e.g., '[PLAN]' or '[EXEC]') */
  planModeIndicator?: string;
}

export interface AgentUIProps {
  state: AgentUIState;
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  onInputChange?: (input: string) => void;
  enableQueueInput?: boolean;
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
  // Initialize input from state.currentInput (preserved across pause/resume)
  const [input, setInput] = useState(state.currentInput || '');
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [planModeIndicator, setPlanModeIndicator] = useState('');

  // Subscribe to plan mode changes
  useEffect(() => {
    const planModeManager = getPlanModeManager();
    const updateIndicator = () => {
      setPlanModeIndicator(planModeManager.getPromptIndicator());
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

  // Reset ctrl+c count after 2 seconds
  useEffect(() => {
    if (ctrlCCount > 0) {
      const timer = setTimeout(() => setCtrlCCount(0), 2000);
      return () => clearTimeout(timer);
    }
  }, [ctrlCCount]);

  useInput((char, key) => {
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

    // Handle Enter - queue instruction
    if (key.return && input.trim()) {
      onInstruction(input.trim());
      setInput('');
      return;
    }

    // Handle Backspace
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    // Handle printable characters
    if (char && !key.ctrl && !key.meta) {
      const printable = char.replace(/[\x00-\x1F\x7F]/g, '');
      if (printable) {
        setInput(prev => prev + printable);
      }
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
      {planModeIndicator && (
        <Box>
          <Text color="cyan" bold>{planModeIndicator}</Text>
          <Text color={colors.muted}> Plan mode active - tools are read-only</Text>
        </Box>
      )}

      {/* Static tool outputs - these never re-render once displayed */}
      <Static items={toolOutputItems}>
        {(entry: ToolOutputEntry) => (
          <ToolOutputStatic key={entry.id} entry={entry} />
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
        ctrlCCount={ctrlCCount}
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
          <Text>{finalResponse}</Text>
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
  ctrlCCount: number;
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
  ctrlCCount
}: FixedBottomProps) {
  const { colors } = useTheme();

  return (
    <>
      {/* Status line with spinner */}
      <StatusLine
        isWorking={isWorking}
        status={status}
        elapsed={elapsed}
        tokens={tokens}
        queueCount={queuedInstructions.length}
      />

      {/* Queue notification - show actual queued messages */}
      {queuedInstructions.length > 0 && isWorking && (
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

      {/* Completion stats (shown after work finishes, above input) */}
      {!isWorking && completionStats && (
        <Box marginTop={1}>
          <Text color={colors.muted}>
            Completed in {completionStats.elapsed} · {completionStats.tokens}
          </Text>
        </Box>
      )}

      {/* Input line (visible when working and queue enabled) */}
      {enableQueueInput && (
        <InputLine
          value={input}
          isActive={isWorking}
        />
      )}

      {/* Ctrl+C warning */}
      {ctrlCCount === 1 && (
        <Box marginTop={1}>
          <Text color={colors.warning}>Press Ctrl+C again to exit</Text>
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
    completionStats: null
  };
}
