/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Safe prompt utilities for handling enquirer cancellation
 */
import enquirer from 'enquirer';

/**
 * Wraps enquirer.prompt to gracefully handle user cancellation.
 * Returns null if the user cancels (Ctrl+C, ESC, or readline close).
 */
export async function safePrompt<T>(
  questions: Parameters<typeof enquirer.prompt>[0]
): Promise<T | null> {
  try {
    return await enquirer.prompt<T>(questions);
  } catch (error: any) {
    // Handle user cancellation (Ctrl+C, ESC, readline close)
    if (
      error?.code === 'ERR_USE_AFTER_CLOSE' ||
      error?.message?.includes('cancelled') ||
      error?.message?.includes('canceled')
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Type for enquirer Select prompt
 */
export interface SelectPromptConfig {
  type: 'select';
  name: string;
  message: string;
  choices: Array<{ name: string; message: string }>;
  initial?: number;
}

/**
 * Type for enquirer Confirm prompt
 */
export interface ConfirmPromptConfig {
  type: 'confirm';
  name: string;
  message: string;
  initial?: boolean;
}

/**
 * Type for enquirer Input/Password prompt
 */
export interface InputPromptConfig {
  type: 'input' | 'password';
  name: string;
  message: string;
  initial?: string;
  validate?: (value: unknown) => boolean | string;
}
