/**
 * Unified Prompt Utility
 * Supports both interactive (Ink Modal) and external (HTTP callback) modes
 * @license Apache-2.0
 */
import { showModal, showInput, type ModalOption } from './ink/components/Modal.js';
import type {
  ExternalPromptRequest,
  ExternalPromptResponse,
  PermissionContext,
  PermissionPromptResult,
  PermissionPromptResponse,
} from '../permissions/types.js';
import { normalizePermissionPromptResponse } from '../permissions/types.js';
import { t } from '../i18n/index.js';

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
): Promise<PermissionPromptResult> {
  // External callback mode
  if (isExternalCallbackEnabled()) {
    try {
      const response = await sendExternalRequest({
        type: 'confirm',
        message,
        context
      });
      const structured: PermissionPromptResponse = response.decision
        ? { decision: response.decision, alternative: response.alternative ?? response.value }
        : response.allowed;
      return normalizePermissionPromptResponse(structured);
    } catch (error) {
      // If callback fails, deny by default for safety
      console.error('External callback failed:', error);
      return { decision: 'deny_once' };
    }
  }

  // Check for unrestricted mode (auto-confirm)
  if (process.env.AUTOHAND_NON_INTERACTIVE === '1' ||
      process.env.CI === '1' ||
      process.env.AUTOHAND_YES === '1') {
    return { decision: 'allow_once' };
  }

  // Interactive mode - use Modal
  const options: ModalOption[] = [
    { label: t('commands.permissions.prompt.yes'), value: 'allow_once' },
    { label: t('commands.permissions.prompt.no'), value: 'deny_once' },
    { label: t('commands.permissions.prompt.allowOnce'), value: 'allow_session' },
    { label: t('commands.permissions.prompt.denyOnce'), value: 'deny_session' },
    { label: t('commands.permissions.prompt.allowAlways'), value: 'allow_always' },
    { label: t('commands.permissions.prompt.denyAlways'), value: 'deny_always' },
    { label: t('commands.permissions.prompt.alternative'), value: 'alternative' }
  ];

  const result = await showModal({
    title: message,
    options,
    initialIndex: 0
  });

  if (!result) {
    return { decision: 'deny_once' };
  }

  if (result.value === 'allow_always' || result.value === 'deny_always') {
    const scope = await showModal({
      title: t('commands.permissions.prompt.scopeTitle'),
      options: [
        { label: t('commands.permissions.prompt.scopeProject'), value: 'project' },
        { label: t('commands.permissions.prompt.scopeUser'), value: 'user' },
        { label: t('commands.permissions.prompt.scopeCancel'), value: 'cancel' },
      ],
      initialIndex: 0,
    });

    if (!scope || scope.value === 'cancel') {
      return { decision: 'deny_once' };
    }

    return {
      decision: `${result.value}_${scope.value}` as PermissionPromptResult['decision'],
    };
  }

  if (result.value === 'alternative') {
    const altAnswer = await showInput({
      title: t('commands.permissions.prompt.alternativeTitle')
    });

    if (altAnswer?.trim()) {
      return { decision: 'alternative', alternative: altAnswer.trim() };
    }
    return { decision: 'deny_once' };
  }

  return { decision: result.value as PermissionPromptResult['decision'] };
}
