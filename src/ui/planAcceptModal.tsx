/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { Box, Text, useInput, render } from 'ink';

export interface PlanAcceptOption {
  id: string;
  label: string;
  shortcut?: string;
}

export interface PlanAcceptModalOptions {
  planFilePath: string;
  options: PlanAcceptOption[];
}

export interface PlanAcceptResult {
  type: 'option' | 'custom' | 'cancel';
  optionId?: string;
  customText?: string;
}

interface PlanAcceptModalProps {
  planFilePath: string;
  options: PlanAcceptOption[];
  onSubmit: (result: PlanAcceptResult) => void;
}

function PlanAcceptModal({ planFilePath, options, onSubmit }: PlanAcceptModalProps) {
  const [cursor, setCursor] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Build choices: options + "No, revise" + "Type custom"
  const choices: Array<{
    id: string;
    label: string;
    shortcut?: string;
    type: 'option' | 'revise' | 'custom';
  }> = [
    ...options.map(opt => ({
      id: opt.id,
      label: opt.label,
      shortcut: opt.shortcut,
      type: 'option' as const
    })),
    {
      id: 'revise',
      label: 'No, revise the plan',
      type: 'revise' as const
    },
    {
      id: 'custom',
      label: 'Type here to tell Claude what to change',
      type: 'custom' as const
    }
  ];

  useInput((char, key) => {
    // ESC cancels
    if (key.escape) {
      if (isCustomMode) {
        setIsCustomMode(false);
        setCustomInput('');
      } else {
        onSubmit({ type: 'cancel' });
      }
      return;
    }

    // Custom input mode
    if (isCustomMode) {
      if (key.return) {
        if (customInput.trim()) {
          onSubmit({ type: 'custom', customText: customInput.trim() });
        }
        return;
      }
      if (key.backspace || key.delete) {
        setCustomInput(prev => prev.slice(0, -1));
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setCustomInput(prev => prev + char);
      }
      return;
    }

    // Selection mode
    if (key.return) {
      const selected = choices[cursor];
      if (selected.type === 'custom') {
        setIsCustomMode(true);
      } else if (selected.type === 'revise') {
        onSubmit({ type: 'cancel' });
      } else {
        onSubmit({ type: 'option', optionId: selected.id });
      }
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      setCursor(prev => (prev - 1 + choices.length) % choices.length);
      return;
    }
    if (key.downArrow) {
      setCursor(prev => (prev + 1) % choices.length);
      return;
    }

    // Number shortcuts (1-9)
    if (char && char >= '1' && char <= '9') {
      const index = parseInt(char, 10) - 1;
      if (index < choices.length) {
        const selected = choices[index];
        if (selected.type === 'custom') {
          setIsCustomMode(true);
        } else if (selected.type === 'revise') {
          onSubmit({ type: 'cancel' });
        } else {
          onSubmit({ type: 'option', optionId: selected.id });
        }
      }
      return;
    }
  });

  // Format the plan file path for display (shorten home dir)
  const displayPath = planFilePath.replace(process.env.HOME || '', '~');

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text>Would you like to proceed?</Text>
      <Text> </Text>

      {isCustomMode ? (
        <Box>
          <Text color="gray">{') '}</Text>
          <Text>{customInput}</Text>
          <Text color="gray">▌</Text>
        </Box>
      ) : (
        choices.map((choice, i) => {
          const isSelected = i === cursor;
          const prefix = isSelected ? '❯' : ' ';
          const number = `${i + 1}.`;
          const shortcutText = choice.shortcut ? ` (${choice.shortcut})` : '';

          return (
            <Box key={choice.id}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {prefix} {number} {choice.label}
              </Text>
              {shortcutText && (
                <Text color="gray">{shortcutText}</Text>
              )}
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text color="gray">
        ctrl-g to edit in VS Code · {displayPath}
      </Text>
    </Box>
  );
}

/**
 * Show the plan acceptance modal and return the user's choice
 */
export async function showPlanAcceptModal(options: PlanAcceptModalOptions): Promise<PlanAcceptResult> {
  const { planFilePath, options: acceptOptions } = options;

  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return { type: 'cancel' };
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <PlanAcceptModal
        planFilePath={planFilePath}
        options={acceptOptions}
        onSubmit={(result) => {
          if (completed) return;
          completed = true;
          instance.unmount();
          resolve(result);
        }}
      />,
      { exitOnCtrlC: false }
    );
  });
}
