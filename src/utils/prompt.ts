/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Safe prompt utilities using Ink Modal components
 */
import { showModal, showInput, showPassword, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';

/**
 * Wraps Modal prompts to gracefully handle user cancellation.
 * Returns null if the user cancels (ESC or Ctrl+C).
 *
 * @deprecated Use showModal, showInput, showPassword, or showConfirm directly instead.
 */
export async function safePrompt<T>(
  questions: PromptConfig | PromptConfig[]
): Promise<T | null> {
  const questionArray = Array.isArray(questions) ? questions : [questions];
  const results: any = {};

  for (const question of questionArray) {
    let value: any;

    if (question.type === 'select') {
      const selectConfig = question as SelectPromptConfig;
      const options: ModalOption[] = selectConfig.choices.map(choice => ({
        label: choice.message,
        value: choice.name
      }));

      const result = await showModal({
        title: selectConfig.message,
        options,
        initialIndex: selectConfig.initial
      });

      value = result?.value;
    } else if (question.type === 'confirm') {
      const confirmConfig = question as ConfirmPromptConfig;
      value = await showConfirm({
        title: confirmConfig.message,
        defaultValue: confirmConfig.initial
      });
    } else if (question.type === 'password') {
      const inputConfig = question as InputPromptConfig;
      value = await showPassword({
        title: inputConfig.message,
        validate: inputConfig.validate as any
      });
    } else if (question.type === 'input') {
      const inputConfig = question as InputPromptConfig;
      value = await showInput({
        title: inputConfig.message,
        defaultValue: inputConfig.initial,
        validate: inputConfig.validate as any
      });
    }

    if (value === null || value === undefined) {
      return null;
    }

    results[question.name] = value;
  }

  return results as T;
}

/**
 * Type for Select prompt
 */
export interface SelectPromptConfig {
  type: 'select';
  name: string;
  message: string;
  choices: Array<{ name: string; message: string }>;
  initial?: number;
}

/**
 * Type for Confirm prompt
 */
export interface ConfirmPromptConfig {
  type: 'confirm';
  name: string;
  message: string;
  initial?: boolean;
}

/**
 * Type for Input/Password prompt
 */
export interface InputPromptConfig {
  type: 'input' | 'password';
  name: string;
  message: string;
  initial?: string;
  validate?: (value: unknown) => boolean | string;
}

/**
 * Union type for all prompt configurations
 */
export type PromptConfig = SelectPromptConfig | ConfirmPromptConfig | InputPromptConfig;
