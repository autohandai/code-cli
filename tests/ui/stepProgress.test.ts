/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StepProgress } from '../../src/ui/stepProgress.js';

describe('StepProgress', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('start() logs the first step via console.log', () => {
    const progress = new StepProgress();
    progress.start('Analyzing your project...');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('Analyzing your project...');
    // Should have a step indicator (◌)
    expect(output).toContain('◌');

    progress.clear();
  });

  it('advance() logs the next step', () => {
    const progress = new StepProgress();
    progress.start('Step 1');
    progress.advance('Step 2');

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    const firstOutput = consoleSpy.mock.calls[0][0] as string;
    const secondOutput = consoleSpy.mock.calls[1][0] as string;
    expect(firstOutput).toContain('Step 1');
    expect(secondOutput).toContain('Step 2');

    progress.clear();
  });

  it('renders all three steps incrementally', () => {
    const progress = new StepProgress();
    progress.start('Step 1');
    progress.advance('Step 2');
    progress.advance('Step 3');
    progress.finish();

    // 3 console.log calls: start + 2 advances
    expect(consoleSpy).toHaveBeenCalledTimes(3);
    const messages = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(messages[0]).toContain('Step 1');
    expect(messages[1]).toContain('Step 2');
    expect(messages[2]).toContain('Step 3');
  });

  it('finish() and clear() do not crash', () => {
    const progress = new StepProgress();
    progress.start('Working...');
    expect(() => progress.finish()).not.toThrow();
    expect(() => progress.clear()).not.toThrow();
  });
});
