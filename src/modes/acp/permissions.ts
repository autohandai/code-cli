/**
 * ACP Permissions Bridge
 * In-process permission handling for native ACP mode.
 * Replaces the external adapter's HTTP permission server.
 */

import type { AgentSideConnection, RequestPermissionResponse, ToolKind } from '@agentclientprotocol/sdk';
import { resolveToolKind, resolveToolDisplayName } from './types.js';
import type { PermissionPromptResult } from '../../permissions/types.js';

/**
 * Permission bridge options.
 */
export interface PermissionBridgeOptions {
  /** The ACP connection to request permissions through */
  connection: AgentSideConnection;
  /** The session ID for permission requests */
  sessionId: string;
  /** The current mode ID (affects auto-approve behavior) */
  modeId: string;
}

/**
 * Creates a confirmation callback compatible with AutohandAgent.setConfirmationCallback().
 * Routes permission requests through the ACP protocol directly (no HTTP roundtrip).
 *
 * Mode-aware behavior:
 * - 'unrestricted' / 'full-access': auto-approves all actions
 * - 'restricted': auto-denies all dangerous actions
 * - 'interactive' (default): prompts Zed UI via ACP requestPermission
 * - 'dry-run': auto-denies (preview only)
 */
export function createPermissionBridge(options: PermissionBridgeOptions) {
  const { connection, sessionId } = options;
  let { modeId } = options;

  /**
   * Update the mode (e.g., when user switches modes mid-session).
   */
  const setMode = (newModeId: string) => {
    modeId = newModeId;
  };

  /**
   * The confirmation callback for the agent.
   * Returns a structured permission decision.
   */
  const confirmAction = async (
    message: string,
    context?: { tool?: string; command?: string; path?: string; args?: string[] }
  ): Promise<PermissionPromptResult> => {
    // Auto-approve modes
    if (modeId === 'unrestricted' || modeId === 'full-access' || modeId === 'auto-mode') {
      return { decision: 'allow_once' };
    }

    // Auto-deny modes
    if (modeId === 'restricted' || modeId === 'dry-run') {
      return { decision: 'deny_once' };
    }

    // Interactive mode: request permission through ACP protocol
    const toolName = context?.tool ?? 'action';
    const kind: ToolKind = resolveToolKind(toolName);
    const title = resolveToolDisplayName(toolName);
    const toolCallId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Build locations from context
    const locations: Array<{ path: string }> = [];
    if (context?.path) {
      locations.push({ path: context.path });
    }

    try {
      const response: RequestPermissionResponse = await connection.requestPermission({
        sessionId,
        toolCall: {
          toolCallId,
          title: `${title}: ${message}`,
          kind,
          status: 'pending',
          locations,
          rawInput: {
            tool: toolName,
            description: message,
            command: context?.command,
            path: context?.path,
            args: context?.args,
          },
        },
        options: [
          { kind: 'allow_once', name: 'Yes', optionId: 'allow_once' },
          { kind: 'reject_once', name: 'No', optionId: 'deny_once' },
          { kind: 'allow_once', name: 'Allow Once', optionId: 'allow_session' },
          { kind: 'reject_once', name: 'Deny Once', optionId: 'deny_session' },
          { kind: 'allow_always', name: 'Allow Always (Project)', optionId: 'allow_always_project' },
          { kind: 'allow_always', name: 'Allow Always (User)', optionId: 'allow_always_user' },
          { kind: 'reject_always', name: 'Deny Always (Project)', optionId: 'deny_always_project' },
          { kind: 'reject_always', name: 'Deny Always (User)', optionId: 'deny_always_user' },
          { kind: 'reject_once', name: 'Enter alternative...', optionId: 'alternative' },
        ],
      });

      // Check the response outcome
      if (response.outcome.outcome === 'selected') {
        const optionId = response.outcome.optionId;
        if (optionId === 'alternative') {
          const meta = (response.outcome as { _meta?: Record<string, unknown> })._meta;
          const alternative = typeof meta?.alternative === 'string' ? meta.alternative.trim() : '';
          return alternative
            ? { decision: 'alternative', alternative }
            : { decision: 'deny_once' };
        }
        return { decision: optionId as PermissionPromptResult['decision'] };
      }

      // Cancelled or other outcome = deny
      return { decision: 'deny_once' };
    } catch (error) {
      // If permission request fails (connection issue, etc.), deny for safety
      process.stderr.write(
        `[ACP] Permission request failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return { decision: 'deny_once' };
    }
  };

  return { confirmAction, setMode };
}
