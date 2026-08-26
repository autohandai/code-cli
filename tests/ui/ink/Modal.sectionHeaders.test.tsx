/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { Modal, type ModalOption } from '../../../src/ui/ink/components/Modal.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function renderModal(options: ModalOption[], overrides: { maxVisible?: number; initialIndex?: number } = {}) {
  return render(
    <ThemeProvider>
      <Modal
        title="Choose your LLM provider"
        options={options}
        maxVisible={overrides.maxVisible}
        initialIndex={overrides.initialIndex}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    </ThemeProvider>
  );
}

function frameLines(lastFrame: () => string | undefined): string[] {
  return stripAnsi(lastFrame() ?? '')
    .split('\n')
    .map((line) => line.trimEnd());
}

const groupedOptions: ModalOption[] = [
  { label: 'Autohand AI', value: 'autohandai', header: 'Autohand AI' },
  { label: 'Anthropic', value: 'anthropic', header: 'Third-party providers' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Alpha Gateway', value: 'custom:alpha', header: 'Custom providers' },
  { label: '+ New provider', value: 'new-custom-provider' },
];

describe('Modal section headers', () => {
  it('renders a section header above the first option of each group', () => {
    const { lastFrame } = renderModal(groupedOptions);
    const lines = frameLines(lastFrame);

    const headerIndex = (header: string) => lines.findIndex((line) => line.trim() === header);
    const optionIndex = (label: string) => lines.findIndex((line) => line.includes(label));

    expect(headerIndex('Autohand AI')).toBeGreaterThanOrEqual(0);
    expect(optionIndex('1. Autohand AI')).toBeGreaterThan(headerIndex('Autohand AI'));
    expect(headerIndex('Third-party providers')).toBeGreaterThan(optionIndex('1. Autohand AI'));
    expect(optionIndex('2. Anthropic')).toBeGreaterThan(headerIndex('Third-party providers'));
    expect(headerIndex('Custom providers')).toBeGreaterThan(optionIndex('3. OpenRouter'));
    expect(optionIndex('4. Alpha Gateway')).toBeGreaterThan(headerIndex('Custom providers'));
  });

  it('keeps option numbering continuous across sections so number shortcuts still line up', () => {
    const { lastFrame } = renderModal(groupedOptions);
    const output = stripAnsi(lastFrame() ?? '');

    expect(output).toContain('1. Autohand AI');
    expect(output).toContain('2. Anthropic');
    expect(output).toContain('3. OpenRouter');
    expect(output).toContain('4. Alpha Gateway');
    expect(output).toContain('5. + New provider');
  });

  it('never labels a section header as a disabled option', () => {
    const { lastFrame } = renderModal(groupedOptions);

    expect(stripAnsi(lastFrame() ?? '')).not.toContain('(disabled)');
  });

  it('repeats the owning section header when the viewport starts inside a group', () => {
    const { lastFrame } = renderModal(groupedOptions, { maxVisible: 2, initialIndex: 3 });
    const lines = frameLines(lastFrame);

    const optionIndex = (label: string) => lines.findIndex((line) => line.includes(label));

    expect(optionIndex('3. OpenRouter')).toBeGreaterThanOrEqual(0);
    expect(optionIndex('1. Autohand AI')).toBe(-1);
    expect(lines.findIndex((line) => line.trim() === 'Third-party providers')).toBeGreaterThanOrEqual(0);
    expect(optionIndex('3. OpenRouter')).toBeGreaterThan(
      lines.findIndex((line) => line.trim() === 'Third-party providers')
    );
  });

  it('renders plain lists unchanged when no option carries a header', () => {
    const { lastFrame } = renderModal([
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]);
    const lines = frameLines(lastFrame).filter((line) => line.length > 0);

    expect(lines.some((line) => line.includes('1. Yes'))).toBe(true);
    expect(lines.some((line) => line.includes('2. No'))).toBe(true);
  });
});
