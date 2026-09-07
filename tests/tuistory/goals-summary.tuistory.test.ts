import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import type { Session } from 'tuistory';
import type { GoalSnapshot } from '../../src/goals/types.js';
import {
  createLongGoalsSnapshot, editSecondGoalSummary, openGoalsPanel,
} from '../../src/testing/scenarios/goalsCommandScenario.js';
import {
  createTempAutohandHome, exitInteractive, launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

describe('goals summary Tuistory', () => {
  it('opens /goals view without flooding the terminal and edits the full queued objective', async () => {
    const state = await createTempAutohandHome({
      config: {
        features: { slashGoal: true },
        agent: { autoMemory: false, goalAutoMode: false },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    states.push(state);
    const snapshot = createLongGoalsSnapshot();
    const goalPath = path.join(state.workspaceRoot, '.autohand', 'goals.local.json');
    const persisted: GoalSnapshot = {
      version: 2,
      goals: {
        'other-session': { ...snapshot.goal!, objective: snapshot.peers[0]!.objective },
      },
      queue: [
        { queueId: 'queue-first', objective: snapshot.goal!.objective, source: 'command', createdAt: 1 },
        ...snapshot.queue,
      ],
      completed: [],
      updatedAt: 2,
    };
    await fs.outputJson(goalPath, persisted);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 80, rows: 24,
    });
    sessions.push(session);
    await openGoalsPanel(session, '/goals view');
    await session.waitForText('Goals · 3 total');
    const screen = await session.text({ trimEnd: true });
    expect(screen).toContain('Review the terminal layout… queued');
    expect(screen).toContain('Ship the documentation… paused');
    expect(screen).toContain('enter edit · click edit');
    expect(session.readAll()).not.toContain('FULL_FAILURE_TRANSCRIPT');
    const viewport = session.getTerminalData().lines.slice(-24)
      .map((line) => line.spans.map((span) => span.text).join('')).join('\n');
    expect(viewport).toContain('Goals · 3 total');
    expect(viewport).toContain('❯');

    await editSecondGoalSummary(session);
    await expect.poll(async () => (await fs.readJson(goalPath) as GoalSnapshot).queue[1]?.objective)
      .toBe(`${snapshot.queue[0]!.objective} after review`);
    const updated = await fs.readJson(goalPath) as GoalSnapshot;
    expect(updated.goals).toEqual(persisted.goals);
    expect(updated.queue[0]).toEqual(persisted.queue[0]);
    await session.press(['ctrl', 'g']);
    await session.text({ waitFor: (text) => !text.includes('Goals · 3 total') });
    await exitInteractive(session);
  }, 45_000);
});
