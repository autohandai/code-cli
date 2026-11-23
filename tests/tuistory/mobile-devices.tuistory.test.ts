/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { FULL_SCREEN_GUTTER } from '../../src/ui/ink/FullScreenFrame.js';
import { outputViewport } from '../../src/testing/scenarios/compactOutputScenario.js';
import {
  createMockMobilePairingFetchPreload, createTempAutohandHome, exitInteractive, launchBuiltAutohand,
  type MockOpenRouterFetchPreload, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const NOTICE = `${' '.repeat(FULL_SCREEN_GUTTER)}   ✓ Mobile connected · /devices to view or unpair`;
let session: Session | undefined;
let state: TuistoryTempState | undefined;
let preload: MockOpenRouterFetchPreload | undefined;

afterEach(async () => {
  session?.close();
  await preload?.cleanup();
  await state?.cleanup();
  session = undefined; state = undefined; preload = undefined;
});

describe('paired phone in the full-screen terminal', () => {
  it('shows the connection under the header, lists it with /devices and clears it on unpair', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    preload = await createMockMobilePairingFetchPreload({ pairingStatus: 'claimed' });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 40, waitForDataTimeout: 15_000,
      env: {
        AUTOHAND_API_URL: 'https://api.tuistory.test',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload.importSpecifier}`].filter(Boolean).join(' '),
      },
    });
    const rows = () => outputViewport(session!).split('\n');
    await session.waitForText('❯', { timeout: 20_000 });
    await session.waitIdle();
    expect(rows()[2].trim()).toBe('');

    await session.type('/mobile'); await session.press('enter');
    await session.waitForText('Mobile connected · /devices to view or unpair', { timeout: 20_000 });
    // The standing line is the header's third row, not a note next to the composer.
    expect(rows()[2]).toBe(NOTICE);
    expect(rows().slice(3).join('\n')).not.toContain('connected to this session');

    await session.type('/devices'); await session.press('enter');
    await session.waitForText('✓ Autohand Mobile · connected', { timeout: 10_000 });
    expect(outputViewport(session)).toContain('Unpair it with /devices unpair.');
    expect(rows()[2]).toBe(NOTICE);

    await session.type('/devices unpair'); await session.press('enter');
    await session.waitForText('Phone unpaired.', { timeout: 10_000 });
    await session.text({ timeout: 5_000, waitFor: () => rows()[2].trim() === '' });

    await session.type('/devices'); await session.press('enter');
    await session.waitForText('No phone is paired with this session.', { timeout: 10_000 });
    await exitInteractive(session);
  }, 120_000);
});
