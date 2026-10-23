/** @license Apache-2.0 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyDriver } from '../../../src/testing/drivers/pty-driver.js';
import { runFullScreenLiveOutputPtyScenario } from '../../../src/testing/scenarios/fullScreenScenario.js';

const terminal = new PtyDriver();
let home: string | undefined;
afterEach(async () => {
  terminal.close();
  if (home) await rm(home, { recursive: true, force: true });
});

describe('full-screen live output in node-pty', () => {
  it('expands and collapses a running command while reading history, preserves the draft and exits cleanly', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'full-screen-live-pty-'));
    terminal.launch(process.execPath, ['--import', 'tsx', 'src/testing/scenarios/fullScreenLiveOutputPtyScenario.tsx'], {
      cols: 80, rows: 30, env: { AUTOHAND_HOME: home },
    });
    await runFullScreenLiveOutputPtyScenario(terminal);
    expect(terminal.snapshot()).toContain('FULL_SCREEN_PTY_EXIT');
  });
});
