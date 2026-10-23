/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { createMockAutohandAINativeSequenceServer, createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';
import { driveExtensionEditDuringTurn, driveExtensionLiveReload, LIVE_EXTENSION_ID, writeLiveExtension } from '../../src/testing/scenarios/extensionLiveReloadScenario.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

describe('built CLI extension live reload', () => {
  it('finishes a model request before applying edits and preserves the next draft', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([{ content: 'LIVE_TURN_FINISHED', delayMs: 3_000 }]);
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { fullScreenMode: true, autohand_inference: true },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'test-key', model: 'moa', baseUrl: provider.baseUrl },
      agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false },
    } });
    states.push(state);
    const source = path.join(state.workspaceRoot, 'extension-source');
    await writeLiveExtension(source);
    const { ExtensionService } = await import('../../src/extensions/ExtensionService.js');
    const service = new ExtensionService({ userRoot: path.join(state.autohandHome, 'extensions') });
    await service.install(source, { link: true, trust: true });
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_API_URL: auth.baseUrl, AUTOHAND_AUTH_URL: auth.baseUrl, AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    sessions.push(session);
    try {
      const screen = await driveExtensionEditDuringTurn(session, source, async () => {
        await expect.poll(() => provider.requests.length, { timeout: 20_000 }).toBeGreaterThan(0);
      });
      expect(screen).toContain('❯ preserve while finishing');
      await exitInteractive(session);
    } finally {
      await provider.close();
      await auth.close();
    }
  }, 70_000);

  it.each([false, true])('reloads linked edits in the same REPL and preserves API v1 across a new CLI process (full screen: %s)', async (fullScreenMode) => {
    const state = await createTempAutohandHome({ config: { features: { fullScreenMode }, ui: { promptSuggestions: false } } });
    states.push(state);
    const source = path.join(state.workspaceRoot, 'extension-source');
    await writeLiveExtension(source);
    const auth = await createMockAuthServer();
    const env = { AUTOHAND_API_URL: auth.baseUrl, AUTOHAND_AUTH_URL: auth.baseUrl, AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` };
    const launch = async (args: string[]) => {
      const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, ...args], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, env, rows: 40,
      });
      sessions.push(session);
      return session;
    };
    try {
      const session = await launch([]);
      await session.waitForText('❯', { timeout: 20_000 });
      const install = await launch(['extensions', 'install', source, '--link', '--trust']);
      await waitForExit(install, 20_000);
      expect(install.exitInfo?.exitCode, install.readAll()).toBe(0);
      const screens = await driveExtensionLiveReload(session, source);
      expect((screens.draft.match(/live:TWO|❯ preserve my extension draft/g) ?? []).sort()).toMatchInlineSnapshot(`
        [
          "live:TWO",
          "❯ preserve my extension draft",
        ]
      `);
      expect(screens.repaired).toContain('live:FOUR');
      await exitInteractive(session);

      // A CLI replacement uses the persisted package and trust state, independent of its process cache.
      const restarted = await launch([]);
      await restarted.waitForText('live:FOUR', { timeout: 20_000 });
      await restarted.type('/live-value');
      await restarted.press('enter');
      await restarted.waitForText('LIVE_RESPONSE_FOUR', { timeout: 10_000 });
      const disable = await launch(['extensions', 'disable', LIVE_EXTENSION_ID]);
      await waitForExit(disable, 20_000);
      expect(disable.exitInfo?.exitCode, disable.readAll()).toBe(0);
      await restarted.text({ timeout: 15_000, waitFor: (screen) => !screen.includes('live:FOUR') && screen.includes('❯') });
      await restarted.type('/live-value');
      await restarted.press('enter');
      await restarted.waitForText('Command /live-value is not supported.', { timeout: 10_000 });
      const stateFile = path.join(state.autohandHome, 'extensions/.state', `${LIVE_EXTENSION_ID}.json`);
      expect(await fs.readJson(stateFile)).toMatchObject({ disabled: true, trusted: true, linked: true });
      await exitInteractive(restarted);
    } finally {
      await auth.close();
    }
  }, 120_000);
});
