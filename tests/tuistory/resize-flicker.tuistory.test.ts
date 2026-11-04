/** @license Apache-2.0 */
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { composerCaretLine } from '../../src/testing/assertions/composerCaret.js';
import { readTerminalWriteTrace, TerminalFrameRecorder } from '../../src/testing/assertions/terminalFrames.js';
import { launchTuistorySession, waitForExit, waitForTerminalScreen } from '../../src/testing/drivers/tuistory-driver.js';
import { createTempAutohandHome, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await state?.cleanup(); session = undefined; state = undefined; });

describe('terminal resize frames', () => {
  it.each(['xterm-256color', 'xterm-ghostty', 'screen-256color', 'tmux-256color'].flatMap(terminal => [
    { terminal, synchronized: true, streaming: true },
    { terminal, synchronized: false, streaming: true },
    { terminal, synchronized: false, streaming: false },
  ]))('publishes complete terminal writes for $terminal with synchronized=$synchronized streaming=$streaming', async ({ terminal, synchronized, streaming }) => {
    state = await createTempAutohandHome();
    const tracePath = path.join(state.autohandHome, 'resize-writes.jsonl');
    session = await launchTuistorySession({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve('src/testing/scenarios/resizeFlickerScenario.tsx'), '--full-screen',
        ...(synchronized ? [] : ['--unsupported-sync']), ...(streaming ? ['--streaming'] : [])],
      cwd: process.cwd(), cols: 100, rows: 30, waitForDataTimeout: 15_000,
      env: { ...process.env, AUTOHAND_HOME: state.autohandHome, CI: 'false', FORCE_COLOR: '0',
        AUTOHAND_RESIZE_TERMINAL: terminal, AUTOHAND_RESIZE_WRITE_TRACE: tracePath },
    });
    await session.waitForText('RESIZE_HISTORY retained text');
    await session.type('preserved draft');
    const traceOffset = (await readTerminalWriteTrace(tracePath)).length;
    const sizes = [[100, 24], [90, 24], [80, 26], [70, 24], [60, 22], [70, 24], [80, 26], [90, 28], [100, 30]];
    for (const [columns, rows] of sizes) {
      session.resize({ cols: columns, rows });
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    await session.type('X');
    await session.waitForText('preserved draftX');
    const writes = await readTerminalWriteTrace(tracePath);
    const recorder = new TerminalFrameRecorder(100, 30, '');
    try {
      for (const record of writes.slice(0, traceOffset)) recorder.feedWrite(record);
      const frameOffset = recorder.frames.length;
      for (const record of writes.slice(traceOffset)) recorder.feedWrite(record);
      const frames = recorder.frames.slice(frameOffset);
      expect(writes.every(record => record.terminal === terminal)).toBe(true);
      expect(frames.length).toBeGreaterThanOrEqual(sizes.length);
      for (const [columns, rows] of sizes) {
        expect(writes.slice(traceOffset).some(record => record.columns === columns && record.rows === rows),
          `No terminal write acknowledged ${columns}x${rows}`).toBe(true);
      }
      const incomplete = frames.filter(frame => !frame.text.includes('Autohand Code')
        || !frame.text.includes('RESIZE_HISTORY retained text') || !frame.text.includes('preserved draft')
        || !frame.text.includes('▔') || !frame.text.includes('▁'));
      expect(incomplete[0], `${incomplete.length} terminal writes published an incomplete transcript or composer`).toBeUndefined();
      if (!synchronized) expect(session.getRawOutput()).not.toMatch(/\x1b\[\?2026[hl]/);
    } finally {
      recorder.close();
    }
    if (streaming) {
      await session.press('escape');
      await session.waitForText('RESIZE_STREAM_COMPLETE');
    }
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.getRawOutput()).toContain('RESIZE_PTY_EXIT');
  });

  it.each([false, true])('retains the full screen at every published resize frame with streaming=%s', async streaming => {
    state = await createTempAutohandHome();
    session = await launchTuistorySession({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve('src/testing/scenarios/resizeFlickerScenario.tsx'), '--full-screen',
        '--viewport-markers', ...(streaming ? ['--streaming'] : [])],
      cwd: process.cwd(), cols: 100, rows: 30, waitForDataTimeout: 15_000,
      env: { ...process.env, AUTOHAND_HOME: state.autohandHome, CI: 'false', TERM: 'xterm-256color', FORCE_COLOR: '0' },
    });
    await session.waitForText('RESIZE_HISTORY retained text');
    await session.type('preserved draft');
    const recorder = new TerminalFrameRecorder(100, 30, session.getRawOutput());
    const unsubscribe = session.subscribe(data => recorder.feed(data));
    try {
      const sizes = [[100, 24], [90, 24], [80, 26], [70, 24], [60, 22], [70, 24], [80, 26], [90, 28], [100, 30]];
      for (const [columns, rows] of sizes) {
        const firstFrame = recorder.frames.length;
        recorder.resize(columns, rows);
        session.resize({ cols: columns, rows });
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        const acknowledged = () => recorder.frames.slice(firstFrame).some(frame => frame.sourceColumns === columns && frame.sourceRows === rows);
        const deadline = Date.now() + 2_000;
        while (!acknowledged() && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 10));
        expect(acknowledged(), `The renderer never acknowledged ${columns}x${rows}`).toBe(true);
      }
      await session.type('X');
      await session.waitForText('preserved draftX');
      expect(recorder.frames.length).toBeGreaterThanOrEqual(sizes.length);
      const incompleteFrames = recorder.frames.filter(frame => frame.sourceColumns === frame.columns && frame.sourceRows === frame.rows)
        .filter(frame => !frame.text.includes('Autohand Code')
        || !frame.text.includes('RESIZE_HISTORY retained text') || !frame.text.includes('preserved draft')
        || !frame.text.includes('▔') || !frame.text.includes('▁'));
      expect(incompleteFrames[0], `${incompleteFrames.length} synchronized frames published an incomplete transcript or composer`).toBeUndefined();
    } finally {
      unsubscribe();
      recorder.close();
    }
    if (streaming) {
      await session.press('escape');
      await session.waitForText('RESIZE_STREAM_COMPLETE');
    }
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await session.press(['ctrl', 'c']);
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.getRawOutput()).toContain('RESIZE_PTY_EXIT');
  });

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
    const screen = await waitForTerminalScreen(session, {
      timeout: 5_000,
      waitFor: frame => {
        if (!frame.includes('RESIZE_HISTORY retained text')) return false;
        if (!multiline) return true;
        const lines = frame.split('\n');
        const border = lines.findLastIndex(row => row.trimStart().startsWith('▔'));
        const composer = lines.slice(border + 1).join('\n').split('▁')[0];
        return composer.replaceAll(/\s+/g, ' ').trim() === `❯ ${draft.join(' ').replace(/tail$/, 'taXil')}`;
      },
    });
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
