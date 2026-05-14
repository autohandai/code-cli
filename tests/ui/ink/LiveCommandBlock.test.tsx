/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { LiveCommandBlock, ToolOutputBatchStatic, ToolOutputStatic } from '../../../src/ui/ink/ToolOutput.js';
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

  it('renders git diff output with theme diff colors', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;

      const { lastFrame } = render(
        <I18nProvider>
          <ThemeProvider>
            <ToolOutputStatic
              entry={{
                id: 'tool-1',
                tool: 'git_diff',
                success: true,
                output: [
                  'diff --git a/src/app.ts b/src/app.ts',
                  '@@ -1,2 +1,2 @@',
                  '-const oldValue = true;',
                  '+const newValue = true;',
                ].join('\n'),
                timestamp: Date.now(),
              }}
            />
          </ThemeProvider>
        </I18nProvider>
      );
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toContain('\u001b[38;2;0;188;212m  ┌ diff --git a/src/app.ts b/src/app.ts');
    expect(output).toContain('\u001b[38;2;0;188;212m  ├ @@ -1,2 +1,2 @@');
    expect(output).toContain('\u001b[38;2;76;175;80m  │ +const newValue = true;');
    expect(output).toContain('\u001b[38;2;244;67;54m  │ -const oldValue = true;');
  });

  it('renders git diff chat history tool output with theme diff colors', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;
      const state = createInitialUIState();
      state.chatMessages = [{
        role: 'tool',
        tool: 'git_diff',
        success: true,
        content: [
          'Added 1 line, removed 1 line',
          'diff --git a/src/app.ts b/src/app.ts',
          'index 1111111..2222222 100644',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1,2 +1,2 @@',
          '-const oldValue = true;',
          '+const newValue = true;',
        ].join('\n'),
      }];

      const { lastFrame } = renderAgentUI(state);
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(stripAnsi(output)).toContain('  Added 1 line, removed 1 line');
    expect(output).toContain('\u001b[38;2;76;175;80m  │ +const newValue = true;');
    expect(output).toContain('\u001b[38;2;244;67;54m  │ -const oldValue = true;');
  });

  it('renders git diff colors from theme ANSI even when chalk colors are disabled', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 0;

      const { lastFrame } = render(
        <I18nProvider>
          <ThemeProvider>
            <ToolOutputStatic
              entry={{
                id: 'tool-1',
                tool: 'git_diff',
                success: true,
                output: [
                  'diff --git a/src/app.ts b/src/app.ts',
                  '-const oldValue = true;',
                  '+const newValue = true;',
                ].join('\n'),
                timestamp: Date.now(),
              }}
            />
          </ThemeProvider>
        </I18nProvider>
      );
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toContain('\u001b[38;2;76;175;80m  │ +const newValue = true;');
    expect(output).toContain('\u001b[38;2;244;67;54m  │ -const oldValue = true;');
  });

  it('uses the active theme palette for git diff colors', () => {
    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider themeName="dracula">
          <ToolOutputStatic
            entry={{
              id: 'tool-1',
              tool: 'git_diff',
              success: true,
              output: [
                'diff --git a/src/app.ts b/src/app.ts',
                '-const oldValue = true;',
                '+const newValue = true;',
              ].join('\n'),
              timestamp: Date.now(),
            }}
          />
        </ThemeProvider>
      </I18nProvider>
    );

    const output = lastFrame() ?? '';
    expect(output).toContain('\u001b[38;2;80;250;123m  │ +const newValue = true;');
    expect(output).toContain('\u001b[38;2;255;85;85m  │ -const oldValue = true;');
  });

  it('renders assistant diff fences as themed diff blocks without literal fences', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;
      const state = createInitialUIState();
      state.chatMessages = [{
        role: 'assistant',
        content: [
          'Changed lines:',
          '',
          '``` diff',
          'tests/config/configParser.test.ts',
          '-it("creates new JSON config with tool selection cache enabled by default", async () => {',
          '+it("creates new JSON config with on-by-default runtime helpers", async () => {',
          '```',
        ].join('\n'),
      }];

      const { lastFrame } = renderAgentUI(state);
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(stripAnsi(output)).not.toContain('```');
    expect(output).toContain('\u001b[38;2;76;175;80m  │ +it("creates new JSON config with on-by-default runtime helpers"');
    expect(output).toContain('\u001b[38;2;244;67;54m  │ -it("creates new JSON config with tool selection cache enabled by default"');
  });

  it('renders raw assistant unified diff text with theme diff colors', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;
      const state = createInitialUIState();
      state.chatMessages = [{
        role: 'assistant',
        content: [
          'index 6672471..e83154d 100644',
          '--- a/tests/config.test.ts',
          '+++ b/tests/config.test.ts',
          '@@ -12,6 +12,10 @@ import { getProviderConfig, loadConfig } from \'../src/config\';',
          ' import type { AutohandConfig } from \'../src/types\';',
          '',
          '+  it(\'creates new configs with completion reports enabled by default\', async () => {',
          '+    expect(config.ui?.completionReportEnabled).toBe(true);',
          '+  });',
        ].join('\n'),
      }];

      const { lastFrame } = renderAgentUI(state);
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toContain('\u001b[38;2;76;175;80m  │ +  it(\'creates new configs with completion reports enabled by default\'');
    expect(output).toMatch(/\u001b\[38;2;\d+;\d+;\d+m  ├ @@ -12,6 \+12,10 @@/);
    expect(stripAnsi(output)).toContain('index 6672471..e83154d 100644');
  });

  it('renders batched git diff details with theme diff colors', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;

      const { lastFrame } = render(
        <I18nProvider>
          <ThemeProvider>
            <ToolOutputBatchStatic
              entry={{
                id: 'tool-batch-1',
                type: 'batch',
                allSuccess: true,
                timestamp: Date.now(),
                groups: [{
                  tool: 'git_diff',
                  items: [{
                    tool: 'git_diff',
                    label: 'git_diff',
                    detail: [
                      'diff --git a/src/app.ts b/src/app.ts',
                      '@@ -1,2 +1,2 @@',
                      '-const oldValue = true;',
                      '+const newValue = true;',
                    ].join('\n'),
                    success: true,
                  }],
                }],
              }}
            />
          </ThemeProvider>
        </I18nProvider>
      );
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toContain('\u001b[38;2;76;175;80m  │ +const newValue = true;');
    expect(output).toContain('\u001b[38;2;244;67;54m  │ -const oldValue = true;');
  });

  it('renders completed chat history before the active final response', () => {
    const state = createInitialUIState();
    state.isWorking = false;
    state.chatMessages = [
      { role: 'user', content: 'tell me a good joke about dogs' },
      { role: 'assistant', content: 'Why did the dog sit in the shade? It did not want to be a hot dog.' },
      { role: 'user', content: 'another about monkeys' },
    ];
    state.finalResponse = 'What do you call a monkey in a minefield? A baboom!';

    const { lastFrame } = renderAgentUI(state);

    const output = stripAnsi(lastFrame());
    expect(output).toContain('tell me a good joke about dogs');
    expect(output).toContain('Why did the dog sit in the shade?');
    expect(output).toContain('another about monkeys');
    expect(output).toContain('What do you call a monkey in a minefield?');
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
    expect(output).toContain('line 12');
    expect(output).not.toContain('line 11');
    expect(output).toContain('Ctrl+O expand');
  });

  it('prioritizes stderr in the collapsed live command viewport', () => {
    const entry = {
      id: 'cmd-1',
      command: '! bun lint',
      stdout: Array.from({ length: 20 }, (_, i) => `stdout ${i + 1}`).join('\n'),
      stderr: Array.from({ length: 8 }, (_, i) => `stderr ${i + 1}`).join('\n'),
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
    expect(output).toContain('stderr 8');
    expect(output).toContain('stderr 4');
    expect(output).not.toContain('stderr 3');
    expect(output).not.toContain('stdout 20');
    expect(output).toContain('showing last 5 lines');
    expect(output).toContain('Ctrl+O expand');
  });

  it('renders an empty live command body while waiting for output', () => {
    const entry = {
      id: 'cmd-1',
      command: '! node --check tetris.js',
      stdout: '',
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
    expect(output).toContain('Running ! node --check tetris.js');
    expect(output).toContain('No output yet');
    expect(output).toContain('Ctrl+O expand');
    expect(output).toContain('┌');
    expect(output).toContain('└');
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
