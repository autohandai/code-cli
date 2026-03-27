/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /review slash command:
 * - Queues instructions silently via queueInstruction
 * - Falls back to returning prompt text when queueInstruction unavailable
 * - Incorporates user focus areas
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn(async () => {
      return [
        '---',
        'name: code-reviewer',
        'description: test skill',
        'allowed-tools: read_file find',
        '---',
        '',
        'You are a Staff-level Software Engineer performing a code review.',
        '',
        '## Review Methodology',
        'Analyze across 10 dimensions.',
      ].join('\n');
    }),
  },
}));

vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    white: (s: string) => s,
    bold: { cyan: (s: string) => s },
  },
}));

const { review, metadata } = await import('../../src/commands/review.js');

describe('/review command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('exports correct metadata', () => {
    expect(metadata.command).toBe('/review');
    expect(metadata.implemented).toBe(true);
    expect(metadata.description).toContain('review');
  });

  it('queues instructions silently and returns null when queueInstruction is available', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    const result = await review(ctx as any);

    expect(result).toBeNull();
    expect(queueInstruction).toHaveBeenCalledOnce();
    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Staff-level Software Engineer');
    expect(queued).toContain('Review Target');
    expect(queued).toContain('/tmp/test');
  });

  it('shows a brief status message to the user', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };

    await review(ctx as any);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Starting code review');
    expect(output).toContain('10 dimensions');
  });

  it('shows user focus in the status message', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };

    await review(ctx as any, ['focus', 'on', 'security']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('focus on security');
  });

  it('includes user instructions in the queued prompt', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    await review(ctx as any, ['check', 'error', 'handling']);

    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Additional Focus');
    expect(queued).toContain('check error handling');
  });

  it('falls back to returning prompt text when queueInstruction is unavailable', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {} };

    const result = await review(ctx as any);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Staff-level Software Engineer');
  });

  it('falls back gracefully if SKILL.md is missing', async () => {
    const fse = (await import('fs-extra')).default;
    (fse.readFile as any).mockRejectedValueOnce(new Error('ENOENT'));

    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };
    await review(ctx as any);

    const queued = (ctx.queueInstruction as any).mock.calls[0][0];
    expect(queued).toContain('code review');
  });

  it('returns prompt text in RPC/ACP mode (isNonInteractive) even when queueInstruction exists', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction, isNonInteractive: true };

    const result = await review(ctx as any);

    // In non-interactive mode, should return the prompt (not queue it)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Staff-level Software Engineer');
    // queueInstruction should NOT have been called
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('does not log to console in RPC/ACP mode', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn(), isNonInteractive: true };

    await review(ctx as any);

    // Should not have printed anything to console in non-interactive mode
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('queues and logs in interactive mode (isNonInteractive false)', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction, isNonInteractive: false };

    const result = await review(ctx as any);

    expect(result).toBeNull();
    expect(queueInstruction).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
