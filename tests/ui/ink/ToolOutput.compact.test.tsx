/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentUI, createInitialUIState, type AgentUIState } from '../../../src/ui/ink/AgentUI.js';
import { ExpandedToolOutput, ToolOutputStatic, type ToolOutputEntry } from '../../../src/ui/ink/ToolOutput.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const FULL = Array.from({ length: 83 }, (_, index) => `line ${index + 1}`).join('\n');

const previewEntry = (overrides: Partial<ToolOutputEntry> = {}): ToolOutputEntry => ({
  id: 'fetch-1',
  tool: 'fetch_url',
  success: true,
  output: 'line 1\nline 2\nline 3',
  expandedOutput: FULL,
  timestamp: 1,
  ...overrides,
});

function renderEntry(entry: ToolOutputEntry): string {
  const { lastFrame } = render(
    <ThemeProvider>
      <ToolOutputStatic entry={entry} />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? '');
}

function renderUI(state: AgentUIState, mouseComposerCursor = true) {
  const onToggleToolOutputExpanded = vi.fn();
  const onToggleLiveCommandExpanded = vi.fn();
  const rendered = render(
    <I18nProvider>
      <ThemeProvider>
        <AgentUI
          state={state}
          onInstruction={() => {}}
          onEscape={() => {}}
          onCtrlC={() => {}}
          mouseComposerCursor={mouseComposerCursor}
          onToggleToolOutputExpanded={onToggleToolOutputExpanded}
          onToggleLiveCommandExpanded={onToggleLiveCommandExpanded}
        />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { ...rendered, onToggleToolOutputExpanded, onToggleLiveCommandExpanded };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A left click on the first screen row, followed by the cursor report the UI asks the terminal for. */
async function clickAboveComposer(stdin: { write: (data: string) => void }, composerRow: number): Promise<void> {
  stdin.write('\x1b[<0;5;1M');
  stdin.write(`\x1b[${composerRow};3R`);
  await flush();
}

afterEach(() => {
  cleanup();
});

describe('compact tool output in the transcript', () => {
  it('says how many lines are hidden and which key opens them', () => {
    const frame = renderEntry(previewEntry());

    expect(frame).toContain('line 3');
    expect(frame).not.toContain('line 4');
    expect(frame).toContain('+ 80 lines (ctrl+o to expand)');
  });

  it('uses the singular for one hidden line', () => {
    const frame = renderEntry(previewEntry({ expandedOutput: 'line 1\nline 2\nline 3\nline 4' }));

    expect(frame).toContain('+ 1 line (ctrl+o to expand)');
  });

  it('keeps the plain hint for a summary whose detail is not a longer version of it', () => {
    const frame = renderEntry(previewEntry({ tool: 'tool_search', output: '1 matching tool', expandedOutput: '[{"name":"read_file"}]' }));

    expect(frame).toContain('Ctrl+O expand');
    expect(frame).not.toContain('lines (');
  });

  it('shows no hint when there is nothing more to see', () => {
    const frame = renderEntry(previewEntry({ expandedOutput: undefined }));

    expect(frame).not.toContain('expand');
  });

  it('counts the hidden lines of a failed command under its error box', () => {
    const frame = renderEntry(previewEntry({ tool: 'run_command', success: false, output: 'line 82\nline 83' }));

    expect(frame).toContain('Error');
    expect(frame).toContain('+ 81 lines (ctrl+o to expand)');
  });
});

describe('expanding compact output with the mouse', () => {
  it('opens the latest expandable result on a click outside the composer', async () => {
    const { stdin, lastFrame, onToggleToolOutputExpanded } = renderUI({
      ...createInitialUIState(),
      toolOutputs: [previewEntry()],
    });
    await flush();
    const composerRow = stripAnsi(lastFrame() ?? '').split('\n').findIndex((line) => line.includes('❯')) + 1;

    await clickAboveComposer(stdin, composerRow);

    expect(onToggleToolOutputExpanded).toHaveBeenCalledOnce();
  });

  it('leaves a click alone when no result can be expanded', async () => {
    const { stdin, lastFrame, onToggleToolOutputExpanded } = renderUI({
      ...createInitialUIState(),
      toolOutputs: [previewEntry({ expandedOutput: undefined })],
    });
    await flush();
    const composerRow = stripAnsi(lastFrame() ?? '').split('\n').findIndex((line) => line.includes('❯')) + 1;

    await clickAboveComposer(stdin, composerRow);

    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
  });

  it('prefers a running command over a finished result', async () => {
    const { stdin, lastFrame, onToggleToolOutputExpanded, onToggleLiveCommandExpanded } = renderUI({
      ...createInitialUIState(),
      toolOutputs: [previewEntry()],
      liveCommands: [{ id: 'live-1', command: 'bun test', stdout: 'running', stderr: '', isExpanded: false, startedAt: 1 }],
    } as AgentUIState);
    await flush();
    const composerRow = stripAnsi(lastFrame() ?? '').split('\n').findIndex((line) => line.includes('❯')) + 1;

    await clickAboveComposer(stdin, composerRow);

    expect(onToggleLiveCommandExpanded).toHaveBeenCalledOnce();
    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
  });

  it('does nothing on a click when mouse support is switched off', async () => {
    const { stdin, lastFrame, onToggleToolOutputExpanded } = renderUI({
      ...createInitialUIState(),
      toolOutputs: [previewEntry()],
    }, false);
    await flush();
    const composerRow = stripAnsi(lastFrame() ?? '').split('\n').findIndex((line) => line.includes('❯')) + 1;

    await clickAboveComposer(stdin, composerRow);

    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
  });
});


describe('expanded output viewport', () => {
  it('pages large diffs without taking the composer space and wraps long rows', async () => {
    const detail = Array.from({ length: 690 }, (_, i) => `+ row-${i + 1} ${'wide '.repeat(20)}`).join('\n');
    const { lastFrame, stdin } = render(
      <ThemeProvider>
        <ExpandedToolOutput entry={previewEntry({ tool: 'git_diff', expandedOutput: detail })} terminalRows={24} terminalColumns={60} />
      </ThemeProvider>,
    );
    await flush();
    const first = stripAnsi(lastFrame() ?? '');
    expect(first.split('\n').length).toBeLessThanOrEqual(12);
    expect(first).toContain('row-1 ');
    expect(first).not.toContain('row-690 ');
    expect(first).toContain('PgUp/PgDn');
    stdin.write('\x1b[6~');
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('row-1 ');
    stdin.write('\x1b[5~');
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toBe(first);
  });
});


describe('expanded output page boundaries', () => {
  it('retains the last row and stays on the last page after repeated page down', async () => {
    const { lastFrame, stdin } = render(
      <ThemeProvider>
        <ExpandedToolOutput entry={previewEntry()} terminalRows={24} terminalColumns={60} />
      </ThemeProvider>,
    );
    await flush();
    stdin.write('\x1b[5~');
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Rows 1–8 of 83');
    for (let i = 0; i < 12; i++) {
      stdin.write('\x1b[6~');
      await flush();
    }
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Rows 81–83 of 83');
    expect(frame).toContain('line 83');
    expect(frame.split('\n').length).toBeLessThanOrEqual(12);
  });
});
