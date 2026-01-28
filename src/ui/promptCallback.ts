/**
 * Unified Prompt Utility
 * Supports both interactive (Ink Modal) and external (HTTP callback) modes
 * @license Apache-2.0
 */
import { showModal, showInput, type ModalOption } from './ink/components/Modal.js';
import { safePrompt } from '../utils/prompt.js';
import type {
  ExternalPromptRequest,
  ExternalPromptResponse,
  PermissionContext
} from '../permissions/types.js';

/**
 * Check if external callback mode is enabled
 */
export function isExternalCallbackEnabled(): boolean {
  return !!process.env.AUTOHAND_PERMISSION_CALLBACK_URL;
}

/**
 * Get the callback URL from environment
 */
export function getCallbackUrl(): string | undefined {
  return process.env.AUTOHAND_PERMISSION_CALLBACK_URL;
}

/**
 * Get callback timeout from environment (default: 30 seconds)
 */
export function getCallbackTimeout(): number {
  const timeout = process.env.AUTOHAND_PERMISSION_CALLBACK_TIMEOUT;
  return timeout ? parseInt(timeout, 10) : 30000;
}

/**
 * Send a prompt request to the external callback server
 */
async function sendExternalRequest(request: ExternalPromptRequest): Promise<ExternalPromptResponse> {
  const callbackUrl = getCallbackUrl();
  if (!callbackUrl) {
    throw new Error('External callback URL not configured');
  }

  const timeout = getCallbackTimeout();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Callback server returned ${response.status}`);
    }

    const result = await response.json() as ExternalPromptResponse;
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { allowed: false, reason: 'external_denied' };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Confirm prompt - returns true/false
 * Falls back to Modal if no callback URL is set
 */
export async function confirm(
  message: string,
  context?: PermissionContext
): Promise<boolean> {
  // External callback mode
  if (isExternalCallbackEnabled()) {
    try {
      const response = await sendExternalRequest({
        type: 'confirm',
        message,
        context
      });
      return response.allowed;
    } catch (error) {
      // If callback fails, deny by default for safety
      console.error('External callback failed:', error);
      return false;
    }
  }

  // Check for unrestricted mode (auto-confirm)
  if (process.env.AUTOHAND_NON_INTERACTIVE === '1' ||
      process.env.CI === '1' ||
      process.env.AUTOHAND_YES === '1') {
    return true;
  }

  // Interactive mode - use Modal
  const options: ModalOption[] = [
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
    { label: 'Enter alternative...', value: 'alternative' }
  ];

  const result = await showModal({
    title: message,
    options,
    initialIndex: 0
  });

  if (!result) {
    return false;
  }

  if (result.value === 'yes') {
    return true;
  }

  if (result.value === 'alternative') {
    const altAnswer = await showInput({
      title: 'Enter alternative action (or empty to cancel)'
    });

    if (altAnswer?.trim()) {
      // Return the alternative as a special value that can be handled upstream
      (confirm as any).lastAlternative = altAnswer.trim();
      return 'alternative' as any;
    }
    return false;
  }

  return false;
}

/**
 * Select prompt - returns the chosen option name
 * Falls back to Modal if no callback URL is set
 */
export async function select<T extends string = string>(
  message: string,
  choices: Array<{ name: T; message: string }>,
  context?: PermissionContext
): Promise<T | null> {
  // External callback mode
  if (isExternalCallbackEnabled()) {
    try {
      const response = await sendExternalRequest({
        type: 'select',
        message,
        choices,
        context
      });
      if (response.allowed && response.choice) {
        return response.choice as T;
      }
      return null;
    } catch (error) {
      console.error('External callback failed:', error);
      return null;
    }
  }

  // Interactive mode - use Modal
  const options: ModalOption[] = choices.map(choice => ({
    label: choice.message,
    value: choice.name
  }));

  const result = await showModal({
    title: message,
    options
  });

  return result ? (result.value as T) : null;
}

/**
 * Input prompt - returns the entered value
 * Falls back to Modal if no callback URL is set
 */
export async function input(
  message: string,
  initial?: string,
  context?: PermissionContext
): Promise<string | null> {
  // External callback mode
  if (isExternalCallbackEnabled()) {
    try {
      const response = await sendExternalRequest({
        type: 'input',
        message,
        initial,
        context
      });
      if (response.allowed && response.value !== undefined) {
        return response.value;
      }
      return null;
    } catch (error) {
      console.error('External callback failed:', error);
      return null;
    }
  }

  // Interactive mode - use Modal
  return await showInput({
    title: message,
    defaultValue: initial
  });
}

/**
 * Prompt for multiple inputs at once
 * Falls back to Modal if no callback URL is set
 */
export async function prompt<T extends Record<string, unknown>>(
  questions: Array<{
    type: 'input' | 'select' | 'confirm';
    name: keyof T;
    message: string;
    initial?: string | boolean;
    choices?: Array<{ name: string; message: string }>;
  }>
): Promise<T | null> {
  // External callback mode - process each question sequentially
  if (isExternalCallbackEnabled()) {
    const result: Record<string, unknown> = {};

    for (const question of questions) {
      const request: ExternalPromptRequest = {
        type: question.type,
        message: question.message,
        initial: question.initial as string,
        choices: question.choices
      };

      try {
        const response = await sendExternalRequest(request);
        if (!response.allowed) {
          return null;
        }

        if (question.type === 'confirm') {
          result[question.name as string] = response.allowed;
        } else if (question.type === 'select') {
          result[question.name as string] = response.choice;
        } else {
          result[question.name as string] = response.value;
        }
      } catch (error) {
        console.error('External callback failed:', error);
        return null;
      }
    }

    return result as T;
  }

  // Interactive mode - use safePrompt (Modal-based)
  return await safePrompt<T>(questions as any);
}

/**
 * Wrap existing Modal prompts to support external callbacks
 * This is useful for migrating existing code gradually
 */
export function createPromptWrapper() {
  return {
    confirm,
    select,
    input,
    prompt,
    isExternalCallbackEnabled
  };
}
