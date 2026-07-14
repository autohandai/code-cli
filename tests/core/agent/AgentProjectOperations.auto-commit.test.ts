/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAutoCommitInfo } from '../../../src/actions/git.js';
import {
  performAgentAutoCommit,
  type AgentProjectOperationsHost,
} from '../../../src/core/agent/AgentProjectOperations.js';

vi.mock('../../../src/actions/git.js', () => ({
  getAutoCommitInfo: vi.fn(),
}));

describe('performAgentAutoCommit cancellation', () => {
  beforeEach(() => {
    vi.mocked(getAutoCommitInfo).mockReset().mockReturnValue({
      canCommit: true,
      filesChanged: ['src/index.ts'],
      suggestedMessage: 'Update runtime lifecycle',
      diffSummary: '1 file changed',
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards cancellation to the nested instruction and waits for it to stop', async () => {
    const controller = new AbortController();
    let nestedInstructionAborted = false;
    const runInstruction = vi.fn((_instruction: string, options?: { signal?: AbortSignal }) => (
      new Promise<boolean>((resolve) => {
        options?.signal?.addEventListener('abort', () => {
          nestedInstructionAborted = true;
          resolve(false);
        }, { once: true });
      })
    ));
    const host = {
      runtime: { workspaceRoot: '/workspace' },
      runInstruction,
    } as unknown as AgentProjectOperationsHost;

    const autoCommit = performAgentAutoCommit(host, controller.signal);
    await vi.waitFor(() => expect(runInstruction).toHaveBeenCalledOnce());
    controller.abort();
    await autoCommit;

    expect(nestedInstructionAborted).toBe(true);
    expect(runInstruction).toHaveBeenCalledWith(
      expect.stringContaining('You have uncommitted changes'),
      { signal: controller.signal },
    );
  });

  it('does not inspect or start commit work after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const runInstruction = vi.fn();
    const host = {
      runtime: { workspaceRoot: '/workspace' },
      runInstruction,
    } as unknown as AgentProjectOperationsHost;

    await performAgentAutoCommit(host, controller.signal);

    expect(getAutoCommitInfo).not.toHaveBeenCalled();
    expect(runInstruction).not.toHaveBeenCalled();
  });
});
