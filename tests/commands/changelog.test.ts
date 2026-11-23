/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import React from 'react';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changelog,
  formatChangelog,
  metadata,
  type ChangelogRelease,
} from '../../src/commands/changelog.js';
import { renderAgentSlashCommandResult } from '../../src/core/agent/AgentCommandRuntime.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { ChatLogMessage } from '../../src/session/chatLog.js';
import { renderInkScreen } from '../../src/testing/drivers/ink-driver.js';
import { MarkdownText } from '../../src/ui/ink/components/MarkdownText.js';
import { FullScreenTranscript } from '../../src/ui/ink/fullScreenTranscript.js';

/** GitHub's response for v0.9.12 and one alpha build, reduced to the fields the command reads. */
const publishedReleases = readFileSync(
  new URL('../../src/testing/scenarios/changelogReleases.fixture.json', import.meta.url),
  'utf8',
);

const releases: ChangelogRelease[] = [
  {
    tagName: 'v0.8.3',
    name: 'Terminal polish',
    body: '## Highlights\n\n- Added `--changelog` support.\n- Fixed **release** rendering.',
    publishedAt: '2026-03-01T10:00:00Z',
    url: 'https://github.com/autohandai/code-cli/releases/tag/v0.8.3',
    prerelease: false,
  },
  {
    tagName: 'v0.8.2-alpha.1',
    name: '',
    body: '',
    publishedAt: null,
    url: 'https://github.com/autohandai/code-cli/releases/tag/v0.8.2-alpha.1',
    prerelease: true,
  },
];

/** The message the interactive UI stores for a `/changelog` result. */
function transcriptMessage(result: string): ChatLogMessage {
  const messages: ChatLogMessage[] = [];
  const host = {
    inkRenderer: {
      isRunning: () => true,
      addAssistantMessage: (content: string, renderMarkdown = true) => {
        messages.push({ role: 'assistant', content, ...(renderMarkdown ? {} : { renderMarkdown: false }) });
      },
    },
  };
  renderAgentSlashCommandResult(host, '/changelog', result);
  return messages[0];
}

/** Every row the full-screen transcript shows for a `/changelog` result at this width. */
function fullScreenRows(result: string, width: number): string[] {
  const model = new FullScreenTranscript();
  model.update([transcriptMessage(result)], width);
  model.handleKey('', { ctrl: true, home: true } as Parameters<typeof model.handleKey>[1]);
  return model.view(10_000).lines.map((line) => stripVTControlCharacters(line));
}

/** The rows of one list item: its bullet row and the wrapped rows that follow. */
function listItemRows(rows: string[], firstWords: string): string[] {
  const start = rows.findIndex((row) => row.startsWith(`• ${firstWords}`));
  expect(start, `bullet starting "${firstWords}"`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < rows.length && rows[end].startsWith('  ') && rows[end].trim() !== '') end++;
  return rows.slice(start, end);
}

async function loadPublishedChangelog(): Promise<string> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(publishedReleases, { status: 200 })));
  return changelog();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/changelog command', () => {
  it('keeps the release notes as markdown under a heading per release', () => {
    const output = formatChangelog(releases);

    expect(output.split('\n\n')).toEqual([
      '# Autohand Changelog',
      '## v0.8.3 — Terminal polish',
      'Published Mar 1, 2026  \n<https://github.com/autohandai/code-cli/releases/tag/v0.8.3>',
      '## Highlights',
      '- Added `--changelog` support.\n- Fixed **release** rendering.',
      '## v0.8.2-alpha.1 \\[pre-release\\]',
      '<https://github.com/autohandai/code-cli/releases/tag/v0.8.2-alpha.1>',
      'No release notes provided.',
    ]);
  });

  it('shows a release title as written when it contains markdown punctuation', () => {
    const output = formatChangelog([{ ...releases[0], tagName: 'v1_0_*', name: 'Faster `init` <now> [really]', body: null }]);

    expect(fullScreenRows(output, 80)).toContain('v1_0_* — Faster `init` <now> [really]');
  });

  it('reports an empty release history', () => {
    expect(formatChangelog([])).toBe('# Autohand Changelog\n\nNo published releases found.');
  });

  it('loads and formats releases through the shared command entry point', async () => {
    const output = await changelog({ loadReleases: async () => releases });

    expect(output).toContain('## v0.8.3 — Terminal polish');
    expect(output).toContain('## v0.8.2-alpha.1 \\[pre-release\\]');
  });

  it('reports when release history cannot be loaded', async () => {
    const output = await changelog({
      loadReleases: async () => null,
    });

    expect(output).toBe('Unable to load the release changelog. Check your internet connection and try again.');
  });

  it('registers the command in the slash-command palette', () => {
    expect(metadata).toMatchObject({
      command: '/changelog',
      description: 'view recent GitHub release notes',
      implemented: true,
    });
    expect(SLASH_COMMANDS).toContainEqual(expect.objectContaining({ command: '/changelog' }));
  });
});

describe('/changelog in the full-screen transcript', () => {
  it('is stored as markdown so the transcript lays it out at its own width', async () => {
    const message = transcriptMessage(await loadPublishedChangelog());

    expect(message.role).toBe('assistant');
    expect(message.renderMarkdown).not.toBe(false);
  });

  it('keeps the failure notice as plain text', () => {
    const notice = 'Unable to load the release changelog. Check your internet connection and try again.';

    expect(fullScreenRows(notice, 98).filter(Boolean)).toEqual([notice]);
  });

  describe.each([98, 58])('at %i columns', (width) => {
    it('shows the title, each release and each section as a heading row', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);

      for (const heading of [
        'Autohand Changelog',
        'v0.9.12 — Release v0.9.12',
        'A calmer full-screen terminal',
        'Honest turn outcomes',
        'Sessions, lanes and memory',
        'Updates',
        'Get it',
        'macOS alpha signing',
      ]) {
        expect(rows, heading).toContain(heading);
      }
      expect(rows.some((row) => row.startsWith('v0.9.9-alpha.8d046f0 [pre-release] — Alpha'))).toBe(true);
      expect(rows).toContain('Published Nov 20, 2026');
      expect(rows.filter((row) => /^#{1,6} /.test(row))).toEqual([]);
    });

    it('shows the introduction as a paragraph, not as a list item', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);

      expect(rows.some((row) => row.startsWith("Hey there! We've been busy"))).toBe(true);
      expect(rows.some((row) => row.startsWith('• Hey there!'))).toBe(false);
    });

    it('wraps a long list item under its own text with a single bullet', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);
      const item = listItemRows(rows, 'The transcript no longer jumps');

      expect(item.length).toBeGreaterThan(1);
      expect(item.slice(1).every((row) => /^ {2}\S/.test(row))).toBe(true);
      expect(item.map((row) => row.slice(2).trim()).join(' ')).toBe(
        'The transcript no longer jumps up and down while a turn runs or a message is sent. '
        + 'Rows that are replaced mid-turn hold their place instead of collapsing and reopening.',
      );
    });

    it('gives each list item one bullet', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);
      const section = rows.slice(rows.indexOf('A calmer full-screen terminal'), rows.indexOf('Honest turn outcomes'));

      expect(section.filter((row) => row.startsWith('• '))).toHaveLength(5);
    });

    it('fits every row in the transcript without orphaned words', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);

      expect(rows.filter((row) => stringWidth(row) > width)).toEqual([]);
      const item = listItemRows(rows, 'A turn you stop with Esc');
      expect(item.slice(0, -1).filter((row) => stringWidth(row) < width / 2)).toEqual([]);
    });

    it('keeps inline code, bold text and links intact', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);
      const text = rows.map((row) => row.trim()).join(' ');

      expect(text).toContain('HOOK_TURN_OUTCOME=interrupted');
      expect(text).toContain('needs_review');
      expect(text).toContain('Quickest way:');
      expect(text).not.toContain('**');
      expect(text).toContain("Apple's instructions");
      expect(text).toContain('https://support.apple.com/en-us/102445');
      expect(text).not.toContain('](');
    });

    it('shows install commands as code blocks and the binaries as a table', async () => {
      const rows = fullScreenRows(await loadPublishedChangelog(), width);

      expect(rows).toContain('│ npm install -g autohand-cli');
      expect(rows.filter((row) => row.includes('```'))).toEqual([]);
      expect(rows.some((row) => /^Platform\s+│ Architecture\s+│ Binary$/.test(row))).toBe(true);
      expect(rows.filter((row) => row.includes('|---'))).toEqual([]);
    });

    it('indents nested list items under their parent', () => {
      const nested: ChangelogRelease = {
        ...releases[0],
        body: [
          '- Parent item that is long enough to wrap onto a second transcript row at either tested width for sure.',
          '  - Nested item that is also long enough to wrap onto a second transcript row at either of the two tested widths.',
          '  - Short nested item.',
        ].join('\n'),
      };
      const rows = fullScreenRows(formatChangelog([nested]), width);
      const nestedRows = rows.slice(rows.findIndex((row) => row.startsWith('  ◦ Nested item')));

      expect(listItemRows(rows, 'Parent item').length).toBeGreaterThan(1);
      expect(nestedRows[0]).toMatch(/^ {2}◦ Nested item/);
      expect(nestedRows[1]).toMatch(/^ {4}\S/);
      expect(rows).toContain('  ◦ Short nested item.');
    });
  });
});

describe('/changelog in the classic layout', () => {
  it('renders the stored message as markdown at the terminal width', async () => {
    const message = transcriptMessage(await loadPublishedChangelog());
    const view = renderInkScreen(React.createElement(MarkdownText, { content: message.content }));
    Object.defineProperty(view.stdout, 'columns', { configurable: true, value: 60 });
    view.stdout.emit('resize');

    await vi.waitFor(() => {
      const rows = stripVTControlCharacters(view.lastFrame() ?? '').split('\n');
      expect(rows).toContain('A calmer full-screen terminal');
      expect(listItemRows(rows, 'Click a command or tool result')).toEqual([
        '• Click a command or tool result to expand it, and click',
        '  again to collapse it.',
      ]);
      expect(rows.filter((row) => stringWidth(row) > 60)).toEqual([]);
    });
    view.unmount();
  });
});
