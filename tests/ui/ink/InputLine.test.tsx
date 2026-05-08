/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import chalk from 'chalk';
import { render } from 'ink-testing-library';
import { InputLine } from '../../../src/ui/ink/InputLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { initTheme } from '../../../src/ui/theme/index.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function renderInputLine(value: string) {
  return render(
    <ThemeProvider>
      <InputLine value={value} cursorOffset={value.length} isActive width={24} />
    </ThemeProvider>
  );
}

describe('InputLine', () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 24,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  it('renders explicit newline input as multiple boxed content rows', () => {
    const { lastFrame } = renderInputLine('alpha\nbeta');
    const output = stripAnsi(lastFrame());

    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('does not collapse normal multiline composer text into a paste token', () => {
    const value = 'one\ntwo\nthree\nfour\nfive';
    const { lastFrame } = renderInputLine(value);
    const output = stripAnsi(lastFrame());

    expect(output).toContain('one');
    expect(output).toContain('five');
    expect(output).not.toContain('[Text pasted');
  });

  it('renders wrapped rows for long single-line input', () => {
    const { lastFrame } = renderInputLine('alpha beta gamma delta');
    const output = stripAnsi(lastFrame());

    expect(output).toContain('alpha');
    expect(output).toContain('gamma');
    expect(output.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('renders plain box characters without leaking ANSI control brackets', () => {
    const { lastFrame } = renderInputLine('');
    const output = stripAnsi(lastFrame());

    expect(output).toContain('┌');
    expect(output).toContain('┐');
    expect(output).toContain('└');
    expect(output).toContain('┘');
    expect(output).not.toContain('[K');
  });

  it('renders the active composer without a leading blank row', () => {
    const { lastFrame } = renderInputLine('');
    const output = stripAnsi(lastFrame());

    expect(output.split('\n')[0]).toMatch(/^┌/);
  });

  it('renders next-prompt suggestion separately from the static placeholder', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine
          value=""
          cursorOffset={0}
          isActive
          width={48}
          placeholderText="Build anything"
          nextPromptSuggestion="Run the test suite"
        />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('Run the test suite');
    expect(output).not.toContain('Build anything');
  });

  it('renders the static placeholder when no next-prompt suggestion exists', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine
          value=""
          cursorOffset={0}
          isActive
          width={48}
          placeholderText="Build anything"
        />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('Build anything');
  });

  it('renders inline ghost suffix for shell command suggestions', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine
          value="! git s"
          cursorOffset={7}
          isActive
          width={48}
          borderStyle="shell"
          inlineGhostSuffix="tatus"
        />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('! git status');
  });
});
describe('InputLine themed variants', () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 40,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
    initTheme('dark');
  });

  it('uses the theme ANSI formatter for composer border, text, and background', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/InputLine.tsx'),
      'utf8'
    );

    expect(source).toContain("theme.fgBg(borderToken, 'userMessageBg', borders.top)");
    expect(source).toContain("theme.fgBg('userMessageText', 'userMessageBg', line)");
    expect(source).toContain("theme.fgBg(borderToken, 'userMessageBg', borders.bottom)");
  });

  it('renders default border style with boxed content', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="test" cursorOffset={4} isActive width={40} borderStyle="default" />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('┌');
    expect(output).toContain('test');
    expect(output).toContain('└');
  });

  it('renders plan border style with boxed content', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="test" cursorOffset={4} isActive width={40} borderStyle="plan" />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('┌');
    expect(output).toContain('test');
    expect(output).toContain('└');
  });

  it('renders shell border style with boxed content', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="!test" cursorOffset={5} isActive width={40} borderStyle="shell" />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('┌');
    expect(output).toContain('!test');
    expect(output).toContain('└');
  });

  it('renders active composer box with content', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="content" cursorOffset={7} isActive width={40} />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());

    expect(output).toContain('┌');
    expect(output).toContain('content');
    expect(output).toContain('└');
  });
});

describe('InputLine cursor positioning', () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 80,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  it('positions cursor at end of text when cursorOffset equals text length', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="hello" cursorOffset={5} isActive width={80} />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('hello');
  });

  it('positions cursor in middle of text when cursorOffset is less than text length', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="hello world" cursorOffset={5} isActive width={80} />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('hello');
    expect(output).toContain('world');
  });

  it('renders a visible styled cursor at the cursor offset', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;

      const { lastFrame } = render(
        <ThemeProvider>
          <InputLine value="hello" cursorOffset={2} isActive width={80} />
        </ThemeProvider>
      );
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toMatch(/he(?:\u001b\[[0-9;]*m)+l(?:\u001b\[[0-9;]*m)+lo/);
  });

  it('renders a visible block cursor after the last typed character', () => {
    const originalChalkLevel = chalk.level;
    let output = '';

    try {
      chalk.level = 3;

      const { lastFrame } = render(
        <ThemeProvider>
          <InputLine value="hello" cursorOffset={5} isActive width={80} />
        </ThemeProvider>
      );
      output = lastFrame() ?? '';
    } finally {
      chalk.level = originalChalkLevel;
    }

    expect(output).toMatch(/hello(?:\u001b\[[0-9;]*m)+ /);
  });

  it('handles empty input with cursor at start', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="" cursorOffset={0} isActive width={80} />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('┌');
    expect(output).toContain('└');
  });

  it('handles multiline text with correct cursor row', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="line1\nline2\nline3" cursorOffset={12} isActive width={80} />
      </ThemeProvider>
    );
    const output = stripAnsi(lastFrame());
    expect(output).toContain('line1');
    expect(output).toContain('line2');
    expect(output).toContain('line3');
  });
});
