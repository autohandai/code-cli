/**
 * Unified Prompt Utility
 * Supports both interactive (Ink Modal) and external (HTTP callback) modes
 * @license Apache-2.0
 */
import { showModal, showInput, type ModalOption } from './ink/components/Modal.js';
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
function getCallbackUrl(): string | undefined {
  return process.env.AUTOHAND_PERMISSION_CALLBACK_URL;
}

/**
 * Get callback timeout from environment (default: 30 seconds)
 */
function getCallbackTimeout(): number {
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

