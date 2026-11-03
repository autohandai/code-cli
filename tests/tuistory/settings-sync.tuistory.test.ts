/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { prepareSettingsSyncFailureScenario } from '../../src/testing/scenarios/settingsSyncScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await state?.cleanup(); session = undefined; state = undefined; });
describe('built settings sync health', () => {
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
