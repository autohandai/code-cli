/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';
import { attachTeamActivityBridge } from '../../../src/core/agent/TeamActivityBridge.js';
import type { InteractionMode } from '../../../src/core/agent/InteractionModeController.js';
import type { AgentOutputEvent } from '../../../src/types.js';

describe('TeamActivityBridge', () => {
  it('switches an interactive default session to auto mode and streams live snapshots', () => {
    const manager = new TeamManager({ leadSessionId: 'lead-1', workspacePath: '/tmp' });
    const snapshots: unknown[] = [];
    const events: AgentOutputEvent[] = [];
    let mode: InteractionMode = 'default';
    const detach = attachTeamActivityBridge({
      teamManager: manager,
      isInteractive: true,
      getInteractionMode: () => mode,
      setInteractionMode: (nextMode) => {
        mode = nextMode;
      },
      setTeamActivity: (snapshot) => snapshots.push(snapshot),
      emitOutput: (event) => events.push(event),
      notifyUser: vi.fn(),
    });

    manager.createTeam('prompt-shrink');
    const task = manager.tasks.createTask({ subject: 'Plan', description: '' });

    expect(mode).toBe('automode');
    expect(snapshots.at(-1)).toEqual(expect.objectContaining({
      team: expect.objectContaining({ name: 'prompt-shrink' }),
      tasks: [expect.objectContaining({ id: task.id, status: 'pending' })],
    }));
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'team_update',
      teamActivity: expect.objectContaining({
        tasks: [expect.objectContaining({ id: task.id })],
      }),
    }));
    detach();
  });

  it('announces completion once when every team task finishes', () => {
    const manager = new TeamManager({ leadSessionId: 'lead-1', workspacePath: '/tmp' });
    const notifyUser = vi.fn();
    attachTeamActivityBridge({
      teamManager: manager,
      isInteractive: true,
      getInteractionMode: () => 'automode',
      setInteractionMode: () => {},
      setTeamActivity: () => {},
      emitOutput: () => {},
      notifyUser,
    });
    manager.createTeam('prompt-shrink');
    const task = manager.tasks.createTask({ subject: 'Plan', description: '' });

    manager.tasks.updateTask(task.id, { status: 'completed' });
    manager.tasks.setTaskOutput(task.id, 'already done');

    expect(notifyUser).toHaveBeenCalledOnce();
    expect(notifyUser).toHaveBeenCalledWith('Team "prompt-shrink" completed 1/1 tasks.');
  });

  it('does not override an explicitly selected plan or yolo mode', () => {
    for (const selectedMode of ['plan', 'yolo'] as const) {
      const manager = new TeamManager({ leadSessionId: 'lead-1', workspacePath: '/tmp' });
      const setInteractionMode = vi.fn();
      attachTeamActivityBridge({
        teamManager: manager,
        isInteractive: true,
        getInteractionMode: () => selectedMode,
        setInteractionMode,
        setTeamActivity: () => {},
        emitOutput: () => {},
        notifyUser: () => {},
      });

      manager.createTeam(`team-${selectedMode}`);

      expect(setInteractionMode).not.toHaveBeenCalled();
    }
  });
});
