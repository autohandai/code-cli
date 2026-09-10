/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { PermissionPromptResponse } from '../../../src/permissions/types.js';

async function confirmWith(response: PermissionPromptResponse) {
  const { confirmAgentDangerousAction } = await import('../../../src/core/agent/AgentCommandRuntime.js');
  const executeHooks = vi.fn().mockResolvedValue([]);
  const applyPromptDecision = vi.fn().mockResolvedValue(undefined);
  const host = {
    runtime: { options: {}, config: { ui: {} } },
    confirmationCallback: vi.fn().mockResolvedValue(response),
    permissionManager: { applyPromptDecision },
    hookManager: { executeHooks },
    notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
    getNotificationGuards: () => ({}),
    withModalPause: async <T,>(callback: () => Promise<T>) => callback(),
  };
  const decision = await confirmAgentDangerousAction(host as never, 'Run this command?', {
    tool: 'shell', command: 'rm -rf build', path: undefined,
  });
  return { decision, executeHooks };
}

describe('permission-denied lifecycle event', () => {
  it('fires permission-denied with the refused tool context when the user says no', async () => {
    const { decision, executeHooks } = await confirmWith({ decision: 'deny_once' });
    expect(decision).toEqual({ decision: 'deny_once' });
    expect(executeHooks).toHaveBeenCalledWith('permission-denied', expect.objectContaining({
      tool: 'shell', command: 'rm -rf build', permissionType: 'deny_once',
    }));
  });

  it('does not fire permission-denied when the request is allowed', async () => {
    const { executeHooks } = await confirmWith({ decision: 'allow_prefix_project' });
    expect(executeHooks).not.toHaveBeenCalled();
  });
});
