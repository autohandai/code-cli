import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import type { Session } from 'tuistory';
import type { GoalSnapshot } from '../../src/goals/types.js';
import { GoalManager } from '../../src/goals/GoalManager.js';
import {
  createLongGoalsSnapshot, editSecondGoalSummary, openGoalsPanel, beginFirstGoalDraft, cancelUnavailableGoalDraft,
} from '../../src/testing/scenarios/goalsCommandScenario.js';
import {
  createTempAutohandHome, exitInteractive, launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) { session.close(); await session.waitForExit(5000); }
  for (const state of states.splice(0)) await state.cleanup();
});

describe('goals summary Tuistory', () => {
  it.each([false, true])('keeps queued-goal editing usable by default with fullScreen=%s', async fullScreen => {
    const state = await createTempAutohandHome({
      config: {
        features: { fullScreenMode: fullScreen },
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
    expect(viewport).toContain('Ctrl+G close · ↑↓ navigate');
    expect(viewport).toContain('❯');

    await editSecondGoalSummary(session);
    await expect.poll(async () => (await fs.readJson(goalPath) as GoalSnapshot).queue[1]?.objective)
      .toBe(`${snapshot.queue[0]!.objective} after review`);
    const updated = await fs.readJson(goalPath) as GoalSnapshot;
    expect(updated.goals).toEqual(persisted.goals);
    expect(updated.queue[0]).toEqual(persisted.queue[0]);
    if (fullScreen) {
      const before = await beginFirstGoalDraft(session);
      expect(await new GoalManager(state.workspaceRoot).removeQueuedGoal('queue-first')).toMatchObject({ ok: true });
      const screens = await cancelUnavailableGoalDraft(session);
      expect(screens.warning).toContain('Goal is unavailable. Draft kept; Esc cancels.');
      const composerRow = (screen: string) => screen.split('\n').findIndex(line => line.includes('▔'.repeat(5)));
      expect(composerRow(screens.warning)).toBe(composerRow(before));
      expect(screens.warning.indexOf('Goal is unavailable.')).toBeLessThan(screens.warning.indexOf('▔'.repeat(5)));
      expect(screens.draft).toContain('Goal is unavailable. Draft kept; Esc cancels.');
      expect(screens.draft).toContain('preserved draft');
      expect((await fs.readJson(goalPath) as GoalSnapshot).queue).toHaveLength(1);
    }
    await session.press(['ctrl', 'g']);
    await session.text({ waitFor: (text) => !/Goals · \d+ total/.test(text) });
    await exitInteractive(session);
  }, 45_000);
});
