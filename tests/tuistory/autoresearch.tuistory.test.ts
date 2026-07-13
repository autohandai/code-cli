import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const workspaces: string[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const workspace of workspaces.splice(0)) await fs.remove(workspace);
});

describe('built CLI autoresearch', () => {
  it('starts through auto-research and resumes through the autoresearch alias', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-autoresearch-'));
    workspaces.push(workspace);

    const start = await launchBuiltAutohand([
      'auto-research',
      'optimize',
      'test',
      'runtime',
      '--metric',
      'total_ms',
      '--unit',
      'ms',
      '--direction',
      'lower',
      '--measure',
      'echo "METRIC total_ms=42"',
      '--max-iterations',
      '4',
    ], { cwd: workspace, waitForDataTimeout: 15_000 });
    sessions.push(start);

    await start.waitForText('Auto-research session started', { timeout: 10_000 });
    await start.waitForText('Initialized benchmark config from command options.', { timeout: 10_000 });
    await waitForExit(start);
    expectCleanExit(start);

    expect(await fs.readJson(path.join(workspace, '.auto', 'state.json'))).toEqual(
      expect.objectContaining({
        active: true,
        goal: 'optimize test runtime',
        maxIterations: 4,
      })
    );

    const status = await launchBuiltAutohand(
      ['autoresearch', 'status'],
      { cwd: workspace, waitForDataTimeout: 15_000 }
    );
    sessions.push(status);

    await status.waitForText('Session: optimize test runtime', { timeout: 10_000 });
    await status.waitForText('Iterations: 0 / 4', { timeout: 10_000 });
    await waitForExit(status);
    expectCleanExit(status);
  }, 60_000);
});
