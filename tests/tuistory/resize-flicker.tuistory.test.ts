/** @license Apache-2.0 */
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { composerCaretLine } from '../../src/testing/assertions/composerCaret.js';
import { launchTuistorySession, waitForExit } from '../../src/testing/drivers/tuistory-driver.js';
import { createTempAutohandHome, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await state?.cleanup(); session = undefined; state = undefined; });

describe('terminal resize frames', () => {
  it.each([
    { fullScreen: false, streaming: false, multiline: false },
    { fullScreen: false, streaming: true, multiline: false },
    { fullScreen: true, streaming: false, multiline: false },
    { fullScreen: true, streaming: true, multiline: false },
    { fullScreen: false, streaming: true, multiline: true },
    { fullScreen: true, streaming: true, multiline: true },
  ])('keeps clear and repaint atomic with fullScreen=$fullScreen streaming=$streaming multiline=$multiline', async ({ fullScreen, streaming, multiline }) => {
    state = await createTempAutohandHome();
    session = await launchTuistorySession({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve('src/testing/scenarios/resizeFlickerScenario.tsx'),
        ...(fullScreen ? ['--full-screen'] : []), ...(streaming ? ['--streaming'] : []), ...(multiline ? ['--multiline'] : [])],
      cwd: process.cwd(), cols: 100, rows: 30, waitForDataTimeout: 15_000,
      env: { ...process.env, AUTOHAND_HOME: state.autohandHome, CI: 'false', TERM: 'xterm-256color', FORCE_COLOR: '0' },
    });
    await session.waitForText('RESIZE_HISTORY retained text');
    const draft = multiline ? ['preserved draft', `${'wrapped composer '.repeat(6)}tail`] : ['preserved draft'];
    if (multiline) await session.waitForText('tail');
    else await session.type(draft[0]);
    await session.press('left');
    await session.press('left');
    const offset = session.getRawOutput().length;
    const sizes = [[90, 28], [80, 26], [70, 24], [60, 22], [70, 24], [80, 26], [90, 28], [100, 30]];
    for (const [cols, rows] of sizes) {
      if (multiline) {
        session.resize({ cols: 120, rows: 36 });
        session.resize({ cols: 48, rows: 20 });
      }
      session.resize({ cols, rows });
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    await session.type('X');
    await session.waitForText(multiline ? 'taXil' : 'preserved draXft');
    const screen = await session.text({ immediate: true });
    expect(screen).toContain('RESIZE_HISTORY retained text');
    if (multiline) {
      const rows = screen.split('\n');
      const border = rows.findLastIndex(row => row.trimStart().startsWith('▔'));
      const composer = rows.slice(border + 1).join('\n').split('▁')[0];
      expect(composer.replaceAll(/\s+/g, ' ').trim()).toBe(`❯ ${draft.join(' ').replace(/tail$/, 'taXil')}`);
    }
    const resizeOutput = session.getRawOutput().slice(offset);
    const frames = [...resizeOutput.matchAll(/\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g)].map(match => match[1]);
    const blankFrames = frames.filter(frame => /\x1b\[(?:2J|3J|2K)/.test(frame) && !stripVTControlCharacters(frame).trim());
    expect(blankFrames, `Published ${blankFrames.length} cleared frames without repaint across ${sizes.length} resizes`).toHaveLength(0);
    expect(frames.length).toBeGreaterThan(0);
    if (streaming) {
      expect(screen).toMatch(/RESIZE_STREAM \d+ retained streamed text/);
      await session.press('escape');
      await session.waitForText('RESIZE_STREAM_COMPLETE');
      await session.type('Y');
      await session.waitForText(multiline ? 'taXYil' : 'preserved draXYft');
    }
    await session.waitIdle();
    expect(composerCaretLine(session)).toContain(multiline ? 'taXY|il' : streaming ? 'preserved draXY|ft' : 'preserved draX|ft');
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.getRawOutput()).toContain('RESIZE_PTY_EXIT');
  });
});
