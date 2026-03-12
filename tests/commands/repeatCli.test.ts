/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the --repeat CLI flag (non-interactive mode).
 * Validates parsing, scheduling, execution, and edge cases for
 * `autohand --repeat "<schedule>" "<prompt>"`.
 */
import { describe, it, expect } from 'vitest';
import { parseRepeatFlag } from '../../src/commands/repeatCli.js';

// ─── parseRepeatFlag tests ──────────────────────────────────────────────────

describe('parseRepeatFlag', () => {
  // ─── Basic parsing ────────────────────────────────────────────────────

  it('parses explicit interval and prompt: --repeat "5m" "run tests"', () => {
    const result = parseRepeatFlag('5m', 'run tests');
    expect(result.interval).toBe('5m');
    expect(result.prompt).toBe('run tests');
  });

  it('parses single natural language string: --repeat "every 5 minutes run tests"', () => {
    const result = parseRepeatFlag('every 5 minutes run tests');
    expect(result.interval).toBe('5m');
    expect(result.prompt).toBe('run tests');
  });

  it('parses shorthand intervals: s, m, h, d', () => {
    expect(parseRepeatFlag('30s', 'ping').interval).toBe('30s');
    expect(parseRepeatFlag('10m', 'check').interval).toBe('10m');
    expect(parseRepeatFlag('2h', 'backup').interval).toBe('2h');
    expect(parseRepeatFlag('1d', 'report').interval).toBe('1d');
  });

  it('defaults to 5m when no interval is specified', () => {
    const result = parseRepeatFlag('run tests');
    expect(result.interval).toBe('5m');
    expect(result.prompt).toBe('run tests');
  });

  // ─── maxRuns from CLI ─────────────────────────────────────────────────

  it('parses --max-runs option', () => {
    const result = parseRepeatFlag('5m', 'run tests', { maxRuns: 10 });
    expect(result.maxRuns).toBe(10);
  });

  it('omits maxRuns when not specified', () => {
    const result = parseRepeatFlag('5m', 'run tests');
    expect(result.maxRuns).toBeUndefined();
  });

  it('rejects maxRuns of 0', () => {
    const result = parseRepeatFlag('5m', 'run tests', { maxRuns: 0 });
    expect(result.maxRuns).toBeUndefined();
  });

  it('rejects negative maxRuns', () => {
    const result = parseRepeatFlag('5m', 'run tests', { maxRuns: -5 });
    expect(result.maxRuns).toBeUndefined();
  });

  // ─── expiresIn from CLI ───────────────────────────────────────────────

  it('parses --expires option as shorthand', () => {
    const result = parseRepeatFlag('5m', 'run tests', { expires: '7d' });
    expect(result.expiresIn).toBe('7d');
  });

  it('omits expiresIn when not specified', () => {
    const result = parseRepeatFlag('5m', 'run tests');
    expect(result.expiresIn).toBeUndefined();
  });

  it('rejects invalid expires format', () => {
    const result = parseRepeatFlag('5m', 'run tests', { expires: 'next week' });
    expect(result.expiresIn).toBeUndefined();
  });

  // ─── Edge cases: empty and whitespace ─────────────────────────────────

  it('returns error for empty input', () => {
    const result = parseRepeatFlag('');
    expect(result.error).toBeDefined();
  });

  it('returns error for whitespace-only input', () => {
    const result = parseRepeatFlag('   ');
    expect(result.error).toBeDefined();
  });

  it('returns error when prompt is empty after interval extraction', () => {
    const result = parseRepeatFlag('5m', '');
    expect(result.error).toBeDefined();
  });

  it('returns error when prompt is only whitespace', () => {
    const result = parseRepeatFlag('5m', '   ');
    expect(result.error).toBeDefined();
  });

  // ─── Edge cases: invalid intervals ────────────────────────────────────

  it('returns error for invalid interval format', () => {
    const result = parseRepeatFlag('5x', 'run tests');
    expect(result.error).toBeDefined();
  });

  it('returns error for interval with no unit', () => {
    const result = parseRepeatFlag('123', 'run tests');
    // '123' doesn't match \d+[smhd], should be treated as prompt text
    expect(result.interval).toBe('5m'); // default
    expect(result.prompt).toContain('123');
  });

  // ─── Natural language: "every" variants ───────────────────────────────

  it('parses "every 2 hours check build status"', () => {
    const result = parseRepeatFlag('every 2 hours check build status');
    expect(result.interval).toBe('2h');
    expect(result.prompt).toBe('check build status');
  });

  it('parses "run tests every 5 minutes"', () => {
    const result = parseRepeatFlag('run tests every 5 minutes');
    expect(result.interval).toBe('5m');
    expect(result.prompt).toBe('run tests');
  });

  it('parses "check deploy every day"', () => {
    const result = parseRepeatFlag('check deploy every day');
    expect(result.interval).toBe('1d');
    expect(result.prompt).toBe('check deploy');
  });

  // ─── Preserves technical content ──────────────────────────────────────

  it('preserves slash commands in prompt', () => {
    const result = parseRepeatFlag('5m', '/deploy staging');
    expect(result.prompt).toBe('/deploy staging');
  });

  it('preserves file paths in prompt', () => {
    const result = parseRepeatFlag('10m', 'lint src/core/*.ts');
    expect(result.prompt).toBe('lint src/core/*.ts');
  });

  it('preserves shell commands with special chars', () => {
    const result = parseRepeatFlag('5m', 'echo "hello world"');
    expect(result.prompt).toBe('echo "hello world"');
  });

  it('preserves backtick commands in prompt', () => {
    const result = parseRepeatFlag('5m', 'run `git status` and report');
    expect(result.prompt).toBe('run `git status` and report');
  });

  // ─── Combined options ─────────────────────────────────────────────────

  it('combines interval, maxRuns, and expires', () => {
    const result = parseRepeatFlag('10m', 'run tests', { maxRuns: 5, expires: '2d' });
    expect(result.interval).toBe('10m');
    expect(result.prompt).toBe('run tests');
    expect(result.maxRuns).toBe(5);
    expect(result.expiresIn).toBe('2d');
  });

  it('two-arg form: interval and prompt are separate strings', () => {
    const result = parseRepeatFlag('2h', 'check PR reviews');
    expect(result.interval).toBe('2h');
    expect(result.prompt).toBe('check PR reviews');
  });

  // ─── Disambiguation: conflicting intervals ────────────────────────────

  it('single-string with only a prompt (no schedule keywords)', () => {
    const result = parseRepeatFlag('check every PR for review comments');
    // "every PR" is a quantifier, not a frequency
    expect(result.interval).toBe('5m'); // default
    expect(result.prompt).toContain('every PR');
  });

  it('handles very long prompts without truncation', () => {
    const longPrompt = 'check all the deployment logs and look for errors in the kubernetes pods and report back with a summary of the issues found including pod names and timestamps';
    const result = parseRepeatFlag('5m', longPrompt);
    expect(result.prompt).toBe(longPrompt);
  });
});

// ─── buildRepeatRunConfig tests ─────────────────────────────────────────────

describe('buildRepeatRunConfig', () => {
  it('converts parsed flag to RepeatRunConfig with intervalMs', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '5m',
      prompt: 'run tests',
    });
    expect(config.intervalMs).toBe(5 * 60 * 1000);
    expect(config.prompt).toBe('run tests');
  });

  it('includes maxRuns in config when specified', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '10m',
      prompt: 'check build',
      maxRuns: 3,
    });
    expect(config.maxRuns).toBe(3);
  });

  it('includes expiresInMs in config when specified', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '1h',
      prompt: 'check PRs',
      expiresIn: '7d',
    });
    expect(config.expiresInMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('defaults expiresInMs to 3 days when not specified', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '5m',
      prompt: 'test',
    });
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    expect(config.expiresInMs).toBe(THREE_DAYS_MS);
  });

  it('computes cronExpression from interval', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '5m',
      prompt: 'test',
    });
    expect(config.cronExpression).toBe('*/5 * * * *');
  });

  it('computes humanReadable from interval', async () => {
    const { buildRepeatRunConfig } = await import('../../src/commands/repeatCli.js');
    const config = buildRepeatRunConfig({
      interval: '2h',
      prompt: 'test',
    });
    expect(config.humanReadable).toContain('2 hour');
  });
});
