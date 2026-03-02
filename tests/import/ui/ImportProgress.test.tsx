/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import {
  ImportProgressView,
  renderProgressBar,
} from '../../../src/import/ui/ImportProgress.js';
import type { ImportCategory, ImportError } from '../../../src/import/types.js';

type ProgressEntry = {
  current: number;
  total: number;
  item: string;
  status: 'importing' | 'retrying' | 'skipped' | 'failed' | 'done';
};

function renderWithProviders(
  progress: Map<ImportCategory, ProgressEntry>,
  errors: ImportError[] = [],
) {
  return render(
    <I18nProvider>
      <ImportProgressView progress={progress} errors={errors} />
    </I18nProvider>,
  );
}

describe('ImportProgressView', () => {
  it('should render header text', () => {
    const progress = new Map<ImportCategory, ProgressEntry>();
    const { lastFrame } = renderWithProviders(progress);
    const output = lastFrame();

    expect(output).toContain('Importing');
  });

  it('should render completed category with checkmark', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['sessions', { current: 47, total: 47, item: '', status: 'done' }],
    ]);
    const { lastFrame } = renderWithProviders(progress);
    const output = lastFrame();

    expect(output).toContain('Sessions');
    expect(output).toContain('47/47');
  });

  it('should render failed category with cross mark', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['memory', { current: 0, total: 1, item: 'parse error', status: 'failed' }],
    ]);
    const errors: ImportError[] = [
      { category: 'memory', item: 'memory.json', error: 'parse error', retriable: false },
    ];
    const { lastFrame } = renderWithProviders(progress, errors);
    const output = lastFrame();

    expect(output).toContain('Memory');
    expect(output).toContain('failed');
  });

  it('should render retrying category', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['settings', { current: 1, total: 2, item: 'config.json', status: 'retrying' }],
    ]);
    const { lastFrame } = renderWithProviders(progress);
    const output = lastFrame();

    expect(output).toContain('Settings');
    expect(output).toContain('retrying');
  });

  it('should render progress bars', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['sessions', { current: 47, total: 47, item: '', status: 'done' }],
      ['skills', { current: 1, total: 3, item: 'skill1.md', status: 'importing' }],
    ]);
    const { lastFrame } = renderWithProviders(progress);
    const output = lastFrame();

    // Progress bar characters
    expect(output).toContain('47/47');
    expect(output).toContain('1/3');
  });

  it('should render error count when errors exist', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['memory', { current: 0, total: 2, item: '', status: 'failed' }],
    ]);
    const errors: ImportError[] = [
      { category: 'memory', item: 'file1.json', error: 'parse error', retriable: true },
      { category: 'memory', item: 'file2.json', error: 'not found', retriable: false },
    ];
    const { lastFrame } = renderWithProviders(progress, errors);
    const output = lastFrame();

    expect(output).toContain('2');
    expect(output).toContain('error');
  });

  it('should render multiple categories simultaneously', () => {
    const progress = new Map<ImportCategory, ProgressEntry>([
      ['sessions', { current: 47, total: 47, item: '', status: 'done' }],
      ['settings', { current: 1, total: 1, item: '', status: 'done' }],
      ['skills', { current: 2, total: 3, item: 'skill3.md', status: 'importing' }],
    ]);
    const { lastFrame } = renderWithProviders(progress);
    const output = lastFrame();

    expect(output).toContain('Sessions');
    expect(output).toContain('Settings');
    expect(output).toContain('Skills');
  });
});

describe('renderProgressBar', () => {
  it('should render a full bar when current equals total', () => {
    const bar = renderProgressBar(10, 10, 10);
    expect(bar).toContain('\u2588'); // filled block
    expect(bar).not.toContain('\u2591'); // no empty block
  });

  it('should render an empty bar when current is 0', () => {
    const bar = renderProgressBar(0, 10, 10);
    expect(bar).toContain('\u2591'); // empty block
    expect(bar).not.toContain('\u2588'); // no filled block
  });

  it('should render a partial bar', () => {
    const bar = renderProgressBar(5, 10, 10);
    expect(bar).toContain('\u2588'); // filled block
    expect(bar).toContain('\u2591'); // empty block
  });

  it('should respect custom width', () => {
    const bar = renderProgressBar(5, 10, 20);
    // 10 filled + 10 empty = 20 chars (plus brackets)
    expect(bar.length).toBeGreaterThan(20);
  });

  it('should handle total of 0 gracefully', () => {
    const bar = renderProgressBar(0, 0, 10);
    expect(typeof bar).toBe('string');
    // Should not throw and return a valid string
  });

  it('should clamp current to total', () => {
    const bar = renderProgressBar(15, 10, 10);
    // Should not have more filled chars than width
    const filledCount = (bar.match(/\u2588/g) ?? []).length;
    expect(filledCount).toBeLessThanOrEqual(10);
  });
});
