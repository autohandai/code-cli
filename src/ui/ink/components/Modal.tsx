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
 * Base props shared by all modal modes
 */
interface BaseModalProps {
  /** Title displayed at the top of the modal */
  title: string;
  /** Callback invoked when user cancels (ESC) */
  onCancel?: () => void;
}

/**
 * Props for select mode (original Modal behavior)
 */
export interface SelectModalProps extends BaseModalProps {
  mode?: 'select'; // Optional for backward compatibility
  /** List of selectable options */
  options: ModalOption[];
  /** Callback invoked when an option is selected */
  onSelect: (option: ModalOption) => void;
  /** When true, adds an "Other" option that allows typing custom text */
  allowCustomInput?: boolean;
  /**
   * Multi-select mode (stub for future implementation).
   * @remarks Currently not implemented - accepts prop but has no effect.
   */
  multiSelect?: boolean;
}

/**
 * Props for confirm mode (Yes/No question)
 */
export interface ConfirmModalProps extends BaseModalProps {
  mode: 'confirm';
  /** Text for confirm button (default: "Yes") */
  confirmText?: string;
  /** Text for cancel button (default: "No") */
  cancelText?: string;
  /** Default selection (true=Yes, false=No) */
  defaultValue?: boolean;
  /** Callback invoked when user confirms or declines */
  onConfirm: (confirmed: boolean) => void;
}

/**
 * Props for input mode (text entry)
 */
export interface InputModalProps extends BaseModalProps {
  mode: 'input';
  /** Placeholder text shown when input is empty */
  placeholder?: string;
  /** Default value for the input */
  defaultValue?: string;
  /** Validation function (returns true if valid, string for error message, false for generic error) */
  validate?: (value: string) => boolean | string;
  /** Callback invoked when user submits */
  onSubmit: (value: string) => void;
}

/**
 * Props for password mode (masked text entry)
 */
export interface PasswordModalProps extends BaseModalProps {
  mode: 'password';
  /** Placeholder text shown when input is empty */
  placeholder?: string;
  /** Validation function (returns true if valid, string for error message, false for generic error) */
  validate?: (value: string) => boolean | string;
  /** Callback invoked when user submits */
  onSubmit: (value: string) => void;
}

/**
 * Union type for all modal prop variants
 */
export type ModalProps = SelectModalProps | ConfirmModalProps | InputModalProps | PasswordModalProps;

/** Internal value used to identify the "Other" option */
const OTHER_VALUE = '__other__';

/**
 * A unified modal component supporting multiple modes:
 * - select: Choose from a list of options (default, original behavior)
 * - confirm: Yes/No question
 * - input: Free text entry
 * - password: Masked text entry
 *
 * @example
 * ```tsx
 * // Select mode (backward compatible)
 * <Modal
 *   title="Select an action"
 *   options={[{ label: 'Save', value: 'save' }]}
 *   onSelect={(opt) => console.log(opt.value)}
 * />
 *
 * // Confirm mode
 * <Modal
 *   mode="confirm"
 *   title="Delete this file?"
 *   onConfirm={(yes) => console.log(yes)}
 * />
 *
 * // Input mode
 * <Modal
 *   mode="input"
 *   title="Enter your name"
 *   onSubmit={(value) => console.log(value)}
 * />
 *
 * // Password mode
 * <Modal
 *   mode="password"
 *   title="Enter password"
 *   onSubmit={(value) => console.log(value)}
 * />
 * ```
 */
function Modal(props: ModalProps) {
  const { t } = useTranslation();
  const { title, onCancel } = props;

  // Determine mode (default to 'select' for backward compatibility)
  const mode = 'mode' in props ? props.mode : 'select';

  // State for select mode
  const [cursor, setCursor] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // State for input/password modes
  const [inputValue, setInputValue] = useState(
    (mode === 'input' && props.defaultValue) || ''
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Build choices for select/confirm modes
  const choices = useMemo(() => {
    if (mode === 'select') {
      const items = [...props.options];
      if (props.allowCustomInput) {
        items.push({
          label: t('ui.questionOther'),
          value: OTHER_VALUE,
          disabled: false,
        });
      }
      return items;
    }

    if (mode === 'confirm') {
      const confirmText = props.confirmText ?? t('ui.confirmYes');
      const cancelText = props.cancelText ?? t('ui.confirmNo');
      return [
        { label: confirmText, value: 'yes', disabled: false },
        { label: cancelText, value: 'no', disabled: false },
      ];
    }

    return [];
  }, [mode, props, t]);

  // Initialize cursor for confirm mode
  useState(() => {
    if (mode === 'confirm') {
      const defaultIdx = props.defaultValue === false ? 1 : 0;
      setCursor(defaultIdx);
    }
  });

  const hasNoChoices = mode === 'select' && choices.length === 0;

  // Find next/previous non-disabled option
  const findNextEnabled = useCallback(
    (from: number, direction: 1 | -1): number => {
      const len = choices.length;
      if (len === 0) return 0;

      let next = (from + direction + len) % len;
      let attempts = 0;

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
      if (mode === 'select' && isCustomMode) {
        setIsCustomMode(false);
        setCustomInput('');
      } else {
        onCancel?.();
      }
      return;
    }

    // Handle input/password modes
    if (mode === 'input' || mode === 'password') {
      if (key.return) {
        // Validate before submitting
        if (props.validate) {
          const result = props.validate(inputValue);
          if (result === true) {
            props.onSubmit(inputValue);
          } else if (typeof result === 'string') {
            setValidationError(result);
          } else {
            setValidationError(t('ui.validationError'));
          }
        } else {
          props.onSubmit(inputValue);
        }
        return;
      }

      if (key.backspace || key.delete) {
        setInputValue((prev) => prev.slice(0, -1));
        setValidationError(null);
        return;
      }

      if (char && !key.ctrl && !key.meta) {
        setInputValue((prev) => prev + char);
        setValidationError(null);
      }
      return;
    }

    // Handle select mode custom input
    if (mode === 'select' && isCustomMode) {
      if (key.return) {
        if (customInput.trim()) {
          props.onSelect({
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

    // Handle select/confirm modes - selection
    if (key.return) {
      const selected = choices[cursor];
      if (selected?.disabled) {
        return;
      }

      if (mode === 'select') {
        if (selected?.value === OTHER_VALUE) {
          setIsCustomMode(true);
        } else if (selected) {
          props.onSelect(selected);
        }
      } else if (mode === 'confirm') {
        props.onConfirm(selected?.value === 'yes');
      }
      return;
    }

    // Arrow navigation
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
          return;
        }

        if (mode === 'select') {
          if (selected?.value === OTHER_VALUE) {
            setIsCustomMode(true);
          } else if (selected) {
            props.onSelect(selected);
          }
        } else if (mode === 'confirm') {
          props.onConfirm(selected?.value === 'yes');
        }
      }
      return;
    }
  });

  // Render based on mode
  const renderContent = () => {
    // Input/Password mode
    if (mode === 'input' || mode === 'password') {
      const displayValue = mode === 'password'
        ? '•'.repeat(inputValue.length)
        : inputValue;

      const placeholderText = props.placeholder ||
        (mode === 'password' ? t('ui.passwordPlaceholder') : t('ui.inputPlaceholder'));

      return (
        <>
          <Box>
            <Text color="yellow">&gt; </Text>
            <Text>{displayValue || <Text color="gray">{placeholderText}</Text>}</Text>
            <Text color="gray">█</Text>
          </Box>
          {validationError && (
            <Box marginTop={1}>
              <Text color="red">{validationError}</Text>
            </Box>
          )}
        </>
      );
    }

    // Select mode - custom input
    if (mode === 'select' && isCustomMode) {
      return (
        <Box>
          <Text color="yellow">{t('ui.questionYourAnswer')}: </Text>
          <Text>{customInput}</Text>
          <Text color="gray">{'\u2588'}</Text>
        </Box>
      );
    }

    // Select mode - no choices
    if (hasNoChoices) {
      return (
        <Box>
          <Text color="gray">{t('ui.noOptionsAvailable')}</Text>
        </Box>
      );
    }

    // Select/Confirm mode - show options
    return choices.map((choice, i) => {
      const isSelected = i === cursor;
      const isDisabled = choice.disabled;

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
    });
  };

  // Render hint text
  const renderHint = () => {
    if (mode === 'input' || mode === 'password') {
      return t('ui.inputHint');
    }
    if (mode === 'select' && hasNoChoices) {
      return t('common.pressEscToCancel');
    }
    if (mode === 'select' && isCustomMode) {
      return t('ui.questionCustomHint');
    }
    return t('ui.questionSelectHint');
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">{title}</Text>
      <Text> </Text>
      {renderContent()}
      <Text> </Text>
      <Text color="gray">{renderHint()}</Text>
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

/**
 * Show a confirmation dialog (Yes/No question).
 * Returns true if confirmed, false if cancelled or declined.
 *
 * @example
 * ```ts
 * const confirmed = await showConfirm({
 *   title: 'Delete this file?',
 *   confirmText: 'Yes, delete',
 *   cancelText: 'No, keep it',
 * });
 *
 * if (confirmed) {
 *   console.log('User confirmed');
 * }
 * ```
 */
export async function showConfirm(options: {
  title: string;
  confirmText?: string;
  cancelText?: string;
  defaultValue?: boolean;
}): Promise<boolean> {
  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return false;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <Modal
          mode="confirm"
          title={options.title}
          confirmText={options.confirmText}
          cancelText={options.cancelText}
          defaultValue={options.defaultValue}
          onConfirm={(confirmed) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(confirmed);
          }}
          onCancel={() => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(false); // Treat ESC as "No"
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}

/**
 * Show an input dialog for text entry.
 * Returns the input value or null if cancelled.
 *
 * @example
 * ```ts
 * const name = await showInput({
 *   title: 'Enter your name',
 *   placeholder: 'John Doe',
 *   validate: (val) => val.length > 0 || 'Name cannot be empty',
 * });
 *
 * if (name) {
 *   console.log(`Hello, ${name}!`);
 * }
 * ```
 */
export async function showInput(options: {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string | null> {
  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <Modal
          mode="input"
          title={options.title}
          placeholder={options.placeholder}
          defaultValue={options.defaultValue}
          validate={options.validate}
          onSubmit={(value) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(value);
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

/**
 * Show a password input dialog (text is masked with bullets).
 * Returns the password or null if cancelled.
 *
 * @example
 * ```ts
 * const password = await showPassword({
 *   title: 'Enter your API key',
 *   validate: (val) => val.length >= 8 || 'API key must be at least 8 characters',
 * });
 *
 * if (password) {
 *   console.log('Password entered');
 * }
 * ```
 */
export async function showPassword(options: {
  title: string;
  placeholder?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string | null> {
  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <Modal
          mode="password"
          title={options.title}
          placeholder={options.placeholder}
          validate={options.validate}
          onSubmit={(value) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(value);
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
