/** @license Apache-2.0 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { configureTwoLineStatusBar, inspectLegacyStatusLine } from '../../src/testing/scenarios/statusBarScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, repoRoot, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('status-bar terminal configuration', () => {
  it('navigates layouts and section toggles, saves them, and retains /statusline in a narrow terminal', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    states.push(state);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 80, rows: 24, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    const toggled = await configureTwoLineStatusBar(session);
    expect(toggled).toMatch(/☐.*Project/u);
    await expect(toggled).toMatchFileSnapshot(path.join(repoRoot(), 'src/testing/snapshots/statusBarSections.txt'));
    const config = JSON.parse(await readFile(state.configPath, 'utf8'));
    expect(config.ui.statusBar.layout).toBe('two-line');
    expect(config.ui.statusBar.sections.find((section: { id: string }) => section.id === 'project').enabled).toBe(false);
    const legacy = await inspectLegacyStatusLine(session);
    expect(legacy).toContain('Cancel hint');
    expect(legacy).toContain('Queued requests');
    expect(session.exitInfo).toBeNull();
    await exitInteractive(session);
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 60_000);
});
