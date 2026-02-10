/**
 * ACP Permissions Bridge
 * In-process permission handling for native ACP mode.
 * Replaces the external adapter's HTTP permission server.
 */

import type { AgentSideConnection, RequestPermissionResponse, ToolKind } from '@agentclientprotocol/sdk';
import { resolveToolKind, resolveToolDisplayName } from './types.js';

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
   * Returns true if the action is approved, false if denied.
   */
  const confirmAction = async (
    message: string,
    context?: { tool?: string; command?: string; path?: string; args?: string[] }
  ): Promise<boolean> => {
    // Auto-approve modes
    if (modeId === 'unrestricted' || modeId === 'full-access' || modeId === 'auto-mode') {
      return true;
    }

    // Auto-deny modes
    if (modeId === 'restricted' || modeId === 'dry-run') {
      return false;
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
          { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
          { kind: 'reject_once', name: 'Deny', optionId: 'deny' },
          { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
        ],
      });

      // Check the response outcome
      if (response.outcome.outcome === 'selected') {
        const optionId = response.outcome.optionId;
        return optionId === 'allow' || optionId === 'allow_always';
      }

      // Cancelled or other outcome = deny
      return false;
    } catch (error) {
      // If permission request fails (connection issue, etc.), deny for safety
      process.stderr.write(
        `[ACP] Permission request failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return false;
    }
  };

  return { confirmAction, setMode };
}
