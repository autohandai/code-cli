/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executePendingPostTurnAction,
  unpackQueuedAgentInstruction,
  type PostTurnActionHost,
  type PostTurnEnvironment,
} from '../../../src/core/agent/PostTurnActionCoordinator.js';

const interactiveEnvironment: PostTurnEnvironment = {
  stdinIsTTY: true,
  stdoutIsTTY: true,
  isCI: false,
  isNonInteractive: false,
};

describe('post-turn research publication', () => {
  let workspaceRoot: string;
  let requestResearchPublication: ReturnType<typeof vi.fn>;
  let host: PostTurnActionHost;
  const action = {
    kind: 'publish-research' as const,
    runId: 'run-1',
    reportPath: '.autohand/research/topic.md',
  };

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-post-turn-action-'));
    await fs.outputJson(path.join(workspaceRoot, '.autohand', 'research', 'status.json'), {
      id: action.runId,
      topic: 'Agent testing',
      reportPath: action.reportPath,
      status: 'completed',
      queuedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blockers: [],
    });
    requestResearchPublication = vi.fn(async () => 'Publication complete.');
    host = {
      runtime: {
        workspaceRoot,
        options: { yes: true },
        isCommandMode: false,
        isRpcMode: false,
      },
      shouldExit: false,
      interactiveAutomodeEnabled: false,
      requestResearchPublication,
    };
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('carries a structured action alongside the reserved instruction', () => {
    expect(unpackQueuedAgentInstruction({
      text: 'Run the research',
      postTurnAction: action,
    })).toEqual({
      text: 'Run the research',
      postTurnAction: action,
    });
    expect(unpackQueuedAgentInstruction('ordinary request')).toEqual({
      text: 'ordinary request',
    });
  });

  it('offers once only after a successful completed run with the matching reserved path', async () => {
    const result = await executePendingPostTurnAction(
      host,
      action,
      true,
      interactiveEnvironment,
    );

    expect(result).toBe('Publication complete.');
    expect(requestResearchPublication).toHaveBeenCalledOnce();
    expect(requestResearchPublication).toHaveBeenCalledWith(action.reportPath);
  });

  it.each([
    ['failed turn', false, interactiveEnvironment],
    ['CI', true, { ...interactiveEnvironment, isCI: true }],
    ['piped input', true, { ...interactiveEnvironment, stdinIsTTY: false }],
    ['non-interactive mode', true, { ...interactiveEnvironment, isNonInteractive: true }],
  ])('does not offer after %s even when global yes mode is enabled', async (_label, succeeded, environment) => {
    const result = await executePendingPostTurnAction(host, action, succeeded, environment);

    expect(result).toBeNull();
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });

  it('does not offer when the typed action disagrees with persisted run state', async () => {
    const result = await executePendingPostTurnAction(
      host,
      { ...action, reportPath: '.autohand/research/other.md' },
      true,
      interactiveEnvironment,
    );

    expect(result).toBeNull();
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });
});
