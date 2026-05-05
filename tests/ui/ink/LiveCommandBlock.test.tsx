/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PassThrough } from 'node:stream';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { LiveCommandBlock, ToolOutputStatic } from '../../../src/ui/ink/ToolOutput.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function renderAgentUI(state: ReturnType<typeof createInitialUIState>) {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  return render(
    <I18nProvider>
      <ThemeProvider>
        <AgentUI
          state={state}
          onInstruction={() => {}}
          onEscape={() => {}}
          onCtrlC={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>,
    { stdin }
  );
}

describe('AgentUI live command block', () => {
  it('does not keep completed thinking text in the chat transcript', () => {
    const state = createInitialUIState();
    state.isWorking = false;
    state.thinking = 'User is asking for positive aspects of the current repository.';
    state.finalResponse = 'This repo has strong TUI test coverage.';

    const { lastFrame } = renderAgentUI(state);

    const output = stripAnsi(lastFrame());
    expect(output).toContain('This repo has strong TUI test coverage.');
    expect(output).not.toContain('User is asking for positive aspects');
    expect(output).not.toContain('Thinking:');
  });

  it('does not render model thought narration as completed tool history', () => {
    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <ToolOutputStatic
            entry={{
              id: 'tool-1',
              tool: 'run_command',
              success: true,
              output: '$ pwd\n/Users/igorcosta/Documents/autohand/cli-3',
              timestamp: Date.now(),
              thought: "User requested to run the `pwd` command, so I'll use the run_command tool.",
            }}
          />
        </ThemeProvider>
      </I18nProvider>
    );

    const output = stripAnsi(lastFrame());
    expect(output).toContain('run_command');
    expect(output).toContain('/Users/igorcosta/Documents/autohand/cli-3');
    expect(output).not.toContain('User requested to run');
  });

  it('renders a running shell command block above the composer', () => {
    const state = createInitialUIState();
    state.isWorking = true;
    state.liveCommands = [{
      id: 'cmd-1',
      command: '! bun run proof',
      stdout: 'tests passing\n',
      stderr: 'warning line\n',
      startedAt: Date.now(),
      isExpanded: false,
    }];

    const { lastFrame } = renderAgentUI(state);

    const output = stripAnsi(lastFrame());
    expect(output).toContain('Running ! bun run proof');
    expect(output).toContain('tests passing');
    expect(output).toContain('warning line');
    expect(output).toContain('Plan, search, build anything');
  });

  it('collapses long live command output by default and shows a Ctrl+O hint', () => {
    const entry = {
      id: 'cmd-1',
      command: '! bun run build',
      stdout: Array.from({ length: 16 }, (_, i) => `line ${i + 1}`).join('\n'),
      stderr: '',
      startedAt: Date.now(),
      isExpanded: false,
    };

    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <LiveCommandBlock entry={entry} />
        </ThemeProvider>
      </I18nProvider>
    );

    const output = stripAnsi(lastFrame());
    expect(output).toContain('line 16');
    expect(output).not.toContain('line 4');
    expect(output).toContain('Ctrl+O expand');
  });

  it('shows full live command output when expanded', () => {
    const entry = {
      id: 'cmd-1',
      command: '! bun run build',
      stdout: Array.from({ length: 16 }, (_, i) => `line ${i + 1}`).join('\n'),
      stderr: '',
      startedAt: Date.now(),
      isExpanded: true,
    };

    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <LiveCommandBlock entry={entry} />
        </ThemeProvider>
      </I18nProvider>
    );

    const output = stripAnsi(lastFrame());
    expect(output).toContain('line 1');
    expect(output).toContain('line 16');
    expect(output).toContain('Ctrl+O collapse');
  });
});
