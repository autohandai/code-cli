/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMissingSettingsSyncDownloadScenario, prepareSettingsSyncFailureScenario } from '../../src/testing/scenarios/settingsSyncScenario.js';
import { waitForTerminalScreen } from '../../src/testing/drivers/tuistory-driver.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await state?.cleanup(); session = undefined; state = undefined; });
describe('built settings sync health', () => {
  it('syncs healthy settings with a visible incomplete-history warning and usable full-screen panels', async () => {
    state = await createTempAutohandHome({ config: {
      features: { fullScreenMode: true }, sync: { enabled: true, interval: 60000 },
      api: { baseUrl: 'https://sync.example.invalid' }, ui: { promptSuggestions: false },
    } });
    const preload = await prepareMissingSettingsSyncDownloadScenario(state.autohandHome, { missingSession: true });
    session = await launchBuiltAutohand(['--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: `--import=${preload}` }, cols: 120, rows: 40,
    });
    await session.waitForText('Settings synced with incomplete cloud history', { timeout: 30000 });
    expect(await readFile(path.join(state.autohandHome, 'agents/healthy-cloud-agent.md'), 'utf8')).toBe('healthy cloud agent');
    await expect(access(path.join(state.autohandHome, 'sessions/missing'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const command of ['/sync', '/status']) {
      await session.type(command); await session.press('enter');
      await session.waitForText('1 file unavailable in storage; history is incomplete');
      expect(await session.readAll()).not.toContain('Settings sync is paused:');
      session.writeRaw('\u001b[27u');
      await waitForTerminalScreen(session, { timeout: 5000, waitFor: screen => screen.includes('Plan, search, build anything') });
    }
    await session.type('AFTER_RECOVERY_DRAFT');
    await session.waitForText('AFTER_RECOVERY_DRAFT');
    expect(session.exitInfo).toBeNull();
    await exitInteractive(session);
  });

  it.each([
    ['/status', 'legacy', 'node'], ['/sync', 'legacy', 'node'], ['/status', 'CSI-u', 'node'], ['/sync', 'CSI-u', 'node'],
    ['/status', 'CSI-u', 'bun'], ['/sync', 'CSI-u', 'bun'],
  ] as const)('restores the full-screen transcript and composer after %s displays a download 404 (%s Escape; runtime: %s)', async (command, encoding, runtime) => {
    state = await createTempAutohandHome({ config: {
      features: { fullScreenMode: true },
      sync: { enabled: true, interval: 60000 },
      api: { baseUrl: 'https://sync.example.invalid' },
      ui: { promptSuggestions: false },
    } });
    const preload = await prepareMissingSettingsSyncDownloadScenario(state.autohandHome);
    session = await launchBuiltAutohand(['--config', state.configPath], {
      ...(runtime === 'bun' ? {
        runtimeCommand: 'bun', runtimeArgs: ['--preload', fileURLToPath(preload)],
        entrypoint: path.resolve(import.meta.dirname, '../../src/index.ts'),
      } : {}),
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: `--import=${preload}` }, cols: 120, rows: 40,
    });
    await session.waitForText('Settings sync is paused:', { timeout: 30000 });
    await session.type('hello'); await session.press('enter');
    await session.waitForText('SYNC_UI_TRANSCRIPT_MARKER', { timeout: 20000 });
    await waitForTerminalScreen(session, {
      timeout: 5000,
      waitFor: screen => screen.includes('Completed in') && screen.includes('Plan, search, build anything'),
    });
    await session.type(command); await session.press('enter');
    await session.waitForText(command === '/status' ? 'Settings:' : 'Settings Sync:');
    await session.waitForText('Download failed: 404');
    await delay(3000);
    const panel = await waitForTerminalScreen(session, {
      timeout: 1500,
      waitFor: screen => screen.includes(command === '/status' ? 'Settings:' : 'Settings Sync:')
        && screen.includes('Download failed: 404') && screen.includes('Esc to exit'),
    });
    expect(panel).not.toContain('Plan, search, build anything');
    expect(session.exitInfo).toBeNull();
    if (encoding === 'CSI-u') session.writeRaw('\u001b[27u');
    else await session.press('escape');
    await waitForTerminalScreen(session, {
      timeout: 5000,
      waitFor: screen => screen.includes('SYNC_UI_TRANSCRIPT_MARKER') && screen.includes('Plan, search, build anything'),
    });
    await session.type('AFTER_PANEL_DRAFT');
    const screen = await waitForTerminalScreen(session, {
      timeout: 5000,
      waitFor: value => value.includes('AFTER_PANEL_DRAFT') && value.includes('SYNC_UI_TRANSCRIPT_MARKER'),
    });
    expect(screen).toContain('Autohand Code');
    expect(session.exitInfo).toBeNull();
    await exitInteractive(session);
  });

  it('shows a background failure once and exposes its persisted reason through /sync status', async () => {
    state = await createTempAutohandHome({ config: { sync: { enabled: true, interval: 60000 }, api: { baseUrl: 'https://sync.example.invalid' } } });
    const preload = await prepareSettingsSyncFailureScenario(state.autohandHome);
    session = await launchBuiltAutohand(['--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: `--import=${preload}` }, cols: 120, rows: 40,
    });
    await session.waitForText('Settings sync is paused:', { timeout: 30000 });
    await session.waitForText('Run /sync status');
    await session.type('/sync status'); await session.press('enter');
    await session.waitForText('Failing since');
    expect(await session.readAll()).toContain('413 fixture: session store unavailable');
    await session.type('/status'); await session.press('enter');
    await session.waitForText('Settings sync: sync paused');
    await session.press('escape');
    await exitInteractive(session);
  });
});
