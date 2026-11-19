/** @license Apache-2.0 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import os from 'node:os';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import { FullScreenFrame } from '../../../src/ui/ink/FullScreenFrame.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { SlashCommandDropdown } from '../../../src/ui/ink/SlashCommandDropdown.js';
import { FileMentionDropdown } from '../../../src/ui/ink/FileMentionDropdown.js';
import { SkillMentionDropdown } from '../../../src/ui/ink/SkillMentionDropdown.js';
import { MessageTargetDropdown } from '../../../src/ui/ink/MessageTargetDropdown.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 30));
afterEach(cleanup);

const long = 'an entry description that keeps going well past any width this test renders at '.repeat(3).trim();
const names = ['alpha', 'beta', 'gamma', 'delta', 'omega'];

/** Each case: name, element, and the columns its entry rows leave unused at the end of their width budget. */
const dropdowns: Array<[string, React.ReactNode, number]> = [
  ['slash', <SlashCommandDropdown visible activeIndex={0}
    suggestions={names.map(name => ({ command: `/ENTRY-${name}-with-a-very-long-command-name`, description: long }))} />, 2],
  ['file', <FileMentionDropdown visible activeIndex={0}
    suggestions={names.map(name => ({ path: `${long}/${name}`, filename: `ENTRY-${name}-with-a-very-long-file-name.ts`, directory: long }))} />, 2],
  ['skill', <SkillMentionDropdown visible activeIndex={0}
    suggestions={names.map(name => ({ name: `$ENTRY-${name}-with-a-very-long-skill-name`, description: long, isActive: false }))} />, 2],
  ['message target', <MessageTargetDropdown visible activeIndex={0}
    suggestions={names.map((name, index) => ({ alias: `:ENTRY-${name}-with-a-very-long-alias-name`, label: name, detail: long, kind: 'run' as const, messageable: index % 2 === 0, reason: 'finished' }))} />, 0],
];

describe.each(dropdowns)('%s dropdown', (_name, dropdown, unused) => {
  it.each([100, 60, 40])('keeps every entry on one truncated row inside the full-screen frame at %i columns', async columns => {
    // The test terminal is always 100 columns wide; the outer box stands in for a terminal of the width under test.
    const frame = () => <ThemeProvider><Box width={columns}><FullScreenFrame model={new FullScreenTranscript()} messages={[]} rows={30} columns={columns}
      workspaceRoot={os.homedir()} footer={<Box flexDirection="column">{dropdown}<Text>❯ draft</Text></Box>} /></Box></ThemeProvider>;
    const view = render(frame()); await flush();
    view.rerender(frame()); await flush();
    const rows = stripAnsi(view.lastFrame() ?? '').split('\n');
    const entries = rows.filter(row => row.includes('ENTRY-'));
    expect(entries).toHaveLength(names.length);
    expect(entries.every(row => row.trimEnd().endsWith('…'))).toBe(true);
    // The footer starts on the window edge and its budget ends one column short of the terminal.
    expect(entries.every(row => /^\S/u.test(row) || /^ {2}\S/u.test(row))).toBe(true);
    expect(entries.map(row => stringWidth(row.trimEnd()))).toEqual(names.map(() => columns - 1 - unused));
    expect(Math.max(...rows.map(row => stringWidth(row)))).toBeLessThanOrEqual(columns - 1);
    const first = rows.indexOf(entries[0]!);
    expect(rows.slice(first, first + names.length)).toEqual(entries);
    expect(rows.at(-1)).toBe('❯ draft');
  });

  it('keeps the classic budget of the terminal width less one column outside the frame', async () => {
    const view = render(<ThemeProvider>{dropdown}</ThemeProvider>); await flush();
    const entries = stripAnsi(view.lastFrame() ?? '').split('\n').filter(row => row.includes('ENTRY-'));
    expect(entries).toHaveLength(names.length);
    expect(entries.map(row => stringWidth(row.trimEnd()))).toEqual(names.map(() => view.stdout.columns - 1 - unused));
  });
});
