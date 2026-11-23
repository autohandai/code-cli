/** @license Apache-2.0 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { RECORDED_RELEASES_ENV, scrollTranscriptToTop, showChangelog } from '../../src/testing/scenarios/changelogScenario.js';
import { FULL_SCREEN_GUTTER } from '../../src/ui/ink/FullScreenFrame.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

let state: TuistoryTempState | undefined;
let session: Session | undefined;

afterEach(async () => {
  session?.close();
  await state?.cleanup();
  session = undefined;
  state = undefined;
});

async function launch(fullScreenMode: boolean, cols: number): Promise<Session> {
  state = await createTempAutohandHome({ config: { features: { fullScreenMode }, ui: { promptSuggestions: false } } });
  session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols, rows: 40,
    env: RECORDED_RELEASES_ENV,
  });
  return session;
}

/** The rows from the one equal to `first` up to, not including, the one equal to `next`. */
function rowsBetween(rows: string[], first: string, next: string): string[] {
  return rows.slice(rows.indexOf(first), rows.indexOf(next)).filter(Boolean);
}

describe('/changelog', () => {
  it.each([
    { cols: 100, next: '• Click a command or tool result to expand it, and click again to collapse it.', section: [
      'A calmer full-screen terminal',
      '• The transcript no longer jumps up and down while a turn runs or a message is sent. Rows that',
      '  are replaced mid-turn hold their place instead of collapsing and reopening.',
      '• Drag across transcript text to select it; the selection is highlighted and copied when you',
      '  release. The highlight no longer depends on detected colour support.',
    ] },
    { cols: 60, next: '• Click a command or tool result to expand it, and click', section: [
      'A calmer full-screen terminal',
      '• The transcript no longer jumps up and down while a turn',
      '  runs or a message is sent. Rows that are replaced',
      '  mid-turn hold their place instead of collapsing and',
      '  reopening.',
      '• Drag across transcript text to select it; the selection',
      '  is highlighted and copied when you release. The',
      '  highlight no longer depends on detected colour support.',
    ] },
  ])('lays out the release notes as markdown in the full-screen transcript at $cols columns', async ({ cols, next, section }) => {
    const terminal = await launch(true, cols);
    const gutter = ' '.repeat(FULL_SCREEN_GUTTER);

    const tail = (await showChangelog(terminal)).split('\n');
    const head = (await scrollTranscriptToTop(terminal)).split('\n');

    expect(head).toContain(`${gutter}Autohand Changelog`);
    expect(head).toContain(`${gutter}v0.9.12 — Release v0.9.12`);
    expect(head).toContain(`${gutter}Published Nov 20, 2026`);
    expect(rowsBetween(head, `${gutter}A calmer full-screen terminal`, `${gutter}${next}`))
      .toEqual(section.map(row => `${gutter}${row}`));
    expect(tail).toContain(`${gutter}No code changes were found in this comparison range.`);
    expect([...head, ...tail].filter(row => /Get it|npm install|Hey there|Full comparison/.test(row))).toEqual([]);
    expect([...head, ...tail].filter(row => /###|\*\*|\]\(|```/.test(row))).toEqual([]);
    await exitInteractive(terminal);
  });

  it('lays out the release notes as markdown in the classic layout', async () => {
    const terminal = await launch(false, 60);

    const tail = (await showChangelog(terminal)).split('\n');

    expect(tail).toContain('No code changes were found in this comparison range.');
    expect(tail.filter(row => /Get it|npm install|Platform │ Architecture|macOS alpha signing/.test(row))).toEqual([]);
    expect(tail.filter(row => /###|\*\*|\]\(|```/.test(row))).toEqual([]);
    await exitInteractive(terminal);
  });
});
