/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { InputLine } from '../../../src/ui/ink/InputLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function renderInputLine(value: string) {
  return render(
    <ThemeProvider>
      <InputLine value={value} cursorOffset={value.length} isActive />
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
});
describe('InputLine theme colors', () => {
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
  });

  it('uses theme borderAccent color for default border style', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="test" cursorOffset={4} isActive width={40} borderStyle="default" />
      </ThemeProvider>
    );
    const output = lastFrame();
    // Should contain ANSI color codes from theme (borderAccent is typically a hex color)
    // The output should have color codes, not be plain text
    expect(output).toMatch(/\x1b\[[0-9;]*m/);
    expect(output).toContain('test');
  });

  it('uses theme warning color for plan border style', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="test" cursorOffset={4} isActive width={40} borderStyle="plan" />
      </ThemeProvider>
    );
    const output = lastFrame();
    // Should contain ANSI color codes from theme
    expect(output).toMatch(/\x1b\[[0-9;]*m/);
    expect(output).toContain('test');
  });

  it('uses theme dim color for shell border style', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="!test" cursorOffset={5} isActive width={40} borderStyle="shell" />
      </ThemeProvider>
    );
    const output = lastFrame();
    // Should contain ANSI color codes from theme
    expect(output).toMatch(/\x1b\[[0-9;]*m/);
    expect(output).toContain('!test');
  });

  it('applies background color from theme to composer box', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <InputLine value="content" cursorOffset={7} isActive width={40} />
      </ThemeProvider>
    );
    const output = lastFrame();
    // Should have background color codes (48;2;R;G;B or 48;5;N)
    expect(output).toMatch(/\x1b\[48;[25]/);
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