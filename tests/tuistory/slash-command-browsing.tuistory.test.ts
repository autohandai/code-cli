/** @license Apache-2.0 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../../src/testing/drivers/tuistory-driver.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await state?.cleanup(); session = undefined; state = undefined; });

const selected = (screen: string): string | undefined => /▸ (.+?)(?: {2,}|$)/mu.exec(screen)?.[1];
const draftRow = (screen: string): string | undefined => screen.split('\n').find(line => line.startsWith('❯ '));

describe('slash command browsing', () => {
  it.each(['/', '/skills '])('browses every option for %j and wraps without changing the typed filter', async query => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 40,
    });
    await session.waitForText('Plan, search, build anything');
    await session.type(query);
    const first = await waitForTerminalScreen(session, { timeout: 5000, waitFor: screen => Boolean(selected(screen)) });
    const visible = [...first.matchAll(/^\s*(?:▸ )?(\/.*?)(?: {2,}|$)/gmu)].map(match => match[1]);
    const initialSelection = selected(first);
    expect(visible.length).toBeGreaterThan(1);
    await session.press('up');
    const last = await waitForTerminalScreen(session, { timeout: 5000, waitFor: screen => Boolean(selected(screen)) && selected(screen) !== initialSelection });
    expect(visible).not.toContain(selected(last));
    expect(draftRow(last)).toBe(draftRow(first));
    await session.press('down');
    await waitForTerminalScreen(session, { timeout: 5000, waitFor: screen => selected(screen) === initialSelection });
    await session.press('up');
    const chosen = selected(last);
    await session.press('tab');
    await waitForTerminalScreen(session, { timeout: 5000, waitFor: screen => draftRow(screen)?.startsWith(`❯ ${chosen}`) === true });
    await session.press('escape');
    await exitInteractive(session);
  });
});
