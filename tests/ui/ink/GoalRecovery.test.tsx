/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goal } from '../../../src/commands/goal.js';
import { GoalManager } from '../../../src/goals/GoalManager.js';
import { SessionManager } from '../../../src/session/SessionManager.js';
import { ActiveAgentRegistry } from '../../../src/session/ActiveAgentRegistry.js';
import { Modal, showModal } from '../../../src/ui/ink/components/Modal.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

vi.mock('../../../src/ui/ink/components/Modal.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/ui/ink/components/Modal.js')>(),
  showModal: vi.fn(),
}));

describe('goal recovery picker', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-picker-'));
    vi.spyOn(ActiveAgentRegistry.prototype, 'listActive').mockResolvedValue([]);
    vi.mocked(showModal).mockReset().mockResolvedValue(null);
    await new GoalManager(workspaceRoot, { sessionId: 'offline-first' }).createGoal({ objective: 'First recovery objective' });
    await new GoalManager(workspaceRoot, { sessionId: 'offline-second' }).createGoal({ objective: 'Second recovery objective' });
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  async function renderRecoveryPicker() {
    await goal({
      workspaceRoot, config: { configPath: 'unused', features: { slashGoal: true } },
      sessionManager: new SessionManager(path.join(workspaceRoot, 'sessions')), restoreSession: vi.fn(),
    }, ['recover']);
    const options = vi.mocked(showModal).mock.calls[0]?.[0];
    if (!options) throw new Error('Recovery command did not open a picker');
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const ui = render(<ThemeProvider><Modal {...options} onSelect={onSelect} onCancel={onCancel} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { ...ui, onSelect, onCancel };
  }

  it('renders owner identities and supports keyboard selection of the second offline goal', async () => {
    const ui = await renderRecoveryPicker();
    expect(ui.lastFrame()).toContain('Recover an offline goal');
    expect(ui.lastFrame()).toContain('offline-first');
    expect(ui.lastFrame()).toContain('goals stay stopped');
    ui.stdin.write('\u001b[B');
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    ui.stdin.write('\r');
    await vi.waitFor(() => expect(ui.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'offline-second' })));
  });

  it.each(['\u001b', '\u0003'])('cancels without selecting a session for %j', async (key) => {
    const ui = await renderRecoveryPicker();
    ui.stdin.write(key);
    await vi.waitFor(() => expect(ui.onCancel).toHaveBeenCalledOnce());
    expect(ui.onSelect).not.toHaveBeenCalled();
  });
});
