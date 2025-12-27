/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { StatusLine } from './StatusLine.js';
import { ToolOutputList, type ToolOutputEntry } from './ToolOutput.js';
import { InputLine } from './InputLine.js';
import { ThinkingOutput } from './ThinkingOutput.js';

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
  // Initialize input from state.currentInput (preserved across pause/resume)
  const [input, setInput] = useState(state.currentInput || '');
  const [ctrlCCount, setCtrlCCount] = useState(0);

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

  return (
    <Box flexDirection="column">
      {/* Tool outputs */}
      <ToolOutputList entries={state.toolOutputs} />

      {/* Thinking output */}
      <ThinkingOutput thought={state.thinking} />

      {/* Final response (when not working) */}
      {state.finalResponse && !state.isWorking && (
        <Box marginTop={1}>
          <Text>{state.finalResponse}</Text>
        </Box>
      )}

      {/* Status line with spinner */}
      <StatusLine
        isWorking={state.isWorking}
        status={state.status}
        elapsed={state.elapsed}
        tokens={state.tokens}
        queueCount={state.queuedInstructions.length}
      />

      {/* Queue notification - show actual queued messages */}
      {state.queuedInstructions.length > 0 && state.isWorking && (
        <Box flexDirection="column" marginTop={1}>
          {state.queuedInstructions.map((instruction, idx) => (
            <Box key={idx}>
              <Text color="gray" italic>
                (queued) - {instruction.length > 60 ? instruction.slice(0, 57) + '...' : instruction}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Completion stats (shown after work finishes, above input) */}
      {!state.isWorking && state.completionStats && (
        <Box marginTop={1}>
          <Text color="gray">
            Completed in {state.completionStats.elapsed} · {state.completionStats.tokens}
          </Text>
        </Box>
      )}

      {/* Input line (visible when working and queue enabled) */}
      {enableQueueInput && (
        <InputLine
          value={input}
          isActive={state.isWorking}
        />
      )}

      {/* Ctrl+C warning */}
      {ctrlCCount === 1 && (
        <Box marginTop={1}>
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        </Box>
      )}
    </Box>
  );
}

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
