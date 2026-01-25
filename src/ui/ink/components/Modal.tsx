/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput, render } from 'ink';
import { I18nProvider, useTranslation } from '../../i18n/index.js';

/**
 * Represents an option in the modal.
 */
export interface ModalOption {
  /** Display label for the option */
  label: string;
  /** Value returned when selected */
  value: string;
  /** Optional description shown below the label */
  description?: string;
  /** Whether the option is disabled (cannot be selected) */
  disabled?: boolean;
}

/**
 * Props for the Modal component.
 */
export interface ModalProps {
  /** Title displayed at the top of the modal */
  title: string;
  /** List of selectable options */
  options: ModalOption[];
  /** Callback invoked when an option is selected */
  onSelect: (option: ModalOption) => void;
  /** Callback invoked when user cancels (ESC) */
  onCancel?: () => void;
  /** When true, adds an "Other" option that allows typing custom text */
  allowCustomInput?: boolean;
  /**
   * Multi-select mode (stub for future implementation).
   * @remarks Currently not implemented - accepts prop but has no effect.
   */
  multiSelect?: boolean;
}

/** Internal value used to identify the "Other" option */
const OTHER_VALUE = '__other__';

/**
 * A unified modal component with arrow navigation, number shortcuts,
 * and optional custom input mode.
 *
 * @example
 * ```tsx
 * <Modal
 *   title="Select an action"
 *   options={[
 *     { label: 'Save', value: 'save' },
 *     { label: 'Cancel', value: 'cancel', description: 'Discard changes' },
 *   ]}
 *   onSelect={(opt) => console.log(opt.value)}
 *   onCancel={() => console.log('cancelled')}
 * />
 * ```
 */
function Modal({
  title,
  options,
  onSelect,
  onCancel,
  allowCustomInput = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  multiSelect = false, // Stub for future - not implemented
}: ModalProps) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Build choices: provided options + optional "Other" option
  const choices = useMemo(() => {
    const items = [...options];
    if (allowCustomInput) {
      items.push({
        label: t('ui.questionOther'),
        value: OTHER_VALUE,
        disabled: false,
      });
    }
    return items;
  }, [options, allowCustomInput, t]);

  // Check if choices are empty (no valid options to select)
  const hasNoChoices = choices.length === 0;

  // Find next/previous non-disabled option
  const findNextEnabled = useCallback(
    (from: number, direction: 1 | -1): number => {
      const len = choices.length;
      if (len === 0) return 0;

      let next = (from + direction + len) % len;
      let attempts = 0;

      // Skip disabled options, with guard against infinite loops
      while (choices[next]?.disabled && attempts < len) {
        next = (next + direction + len) % len;
        attempts++;
      }

      return next;
    },
    [choices]
  );

  useInput((char, key) => {
    // ESC cancels
    if (key.escape) {
      if (isCustomMode) {
        setIsCustomMode(false);
        setCustomInput('');
      } else {
        onCancel?.();
      }
      return;
    }

    // Custom input mode
    if (isCustomMode) {
      if (key.return) {
        if (customInput.trim()) {
          onSelect({
            label: customInput,
            value: customInput,
          });
        }
        return;
      }
      if (key.backspace || key.delete) {
        setCustomInput((prev) => prev.slice(0, -1));
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setCustomInput((prev) => prev + char);
      }
      return;
    }

    // Selection mode
    if (key.return) {
      const selected = choices[cursor];
      if (selected?.disabled) {
        return; // Cannot select disabled option
      }
      if (selected?.value === OTHER_VALUE) {
        setIsCustomMode(true);
      } else if (selected) {
        onSelect(selected);
      }
      return;
    }

    // Arrow navigation with wrap-around
    if (key.upArrow) {
      setCursor((prev) => findNextEnabled(prev, -1));
      return;
    }
    if (key.downArrow) {
      setCursor((prev) => findNextEnabled(prev, 1));
      return;
    }

    // Number shortcuts (1-9)
    if (char && char >= '1' && char <= '9') {
      const index = parseInt(char, 10) - 1;
      if (index < choices.length) {
        const selected = choices[index];
        if (selected?.disabled) {
          return; // Cannot select disabled option
        }
        if (selected?.value === OTHER_VALUE) {
          setIsCustomMode(true);
        } else if (selected) {
          onSelect(selected);
        }
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">{title}</Text>
      <Text> </Text>

      {isCustomMode ? (
        <Box>
          <Text color="yellow">{t('ui.questionYourAnswer')}: </Text>
          <Text>{customInput}</Text>
          <Text color="gray">{'\u2588'}</Text>
        </Box>
      ) : hasNoChoices ? (
        <Box>
          <Text color="gray">{t('ui.noOptionsAvailable')}</Text>
        </Box>
      ) : (
        choices.map((choice, i) => {
          const isSelected = i === cursor;
          const isDisabled = choice.disabled;

          // Determine color based on state
          let color: string | undefined;
          if (isDisabled) {
            color = 'gray';
          } else if (isSelected) {
            color = 'green';
          }

          return (
            <Box key={`${choice.value}-${i}`} flexDirection="column">
              <Text color={color}>
                {isSelected ? '\u25b8 ' : '  '}
                {i + 1}. {choice.label}
                {isDisabled ? ' (disabled)' : ''}
              </Text>
              {choice.description && (
                <Text color="gray">     {choice.description}</Text>
              )}
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text color="gray">
        {hasNoChoices
          ? t('common.pressEscToCancel')
          : isCustomMode
            ? t('ui.questionCustomHint')
            : t('ui.questionSelectHint')}
      </Text>
    </Box>
  );
}

/**
 * Options for showModal helper function.
 */
export interface ShowModalOptions {
  /** Title displayed at the top of the modal */
  title: string;
  /** List of selectable options */
  options: ModalOption[];
  /** When true, adds an "Other" option for custom text input */
  allowCustomInput?: boolean;
  /**
   * Multi-select mode (stub for future implementation).
   * @remarks Currently not implemented.
   */
  multiSelect?: boolean;
}

/**
 * Show a modal dialog and return the selected option.
 * Returns null if user cancels (ESC).
 *
 * @example
 * ```ts
 * const result = await showModal({
 *   title: 'Choose an action',
 *   options: [
 *     { label: 'Save', value: 'save' },
 *     { label: 'Discard', value: 'discard' },
 *   ],
 * });
 *
 * if (result) {
 *   console.log(`Selected: ${result.value}`);
 * }
 * ```
 */
export async function showModal(
  options: ShowModalOptions
): Promise<ModalOption | null> {
  const { title, options: modalOptions, allowCustomInput, multiSelect } = options;

  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <Modal
          title={title}
          options={modalOptions}
          allowCustomInput={allowCustomInput}
          multiSelect={multiSelect}
          onSelect={(option) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(option);
          }}
          onCancel={() => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(null);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}

export { Modal };
export default Modal;
