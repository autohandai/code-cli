/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    gray: (s: string) => s,
  },
}));

const { prReview, metadata } = await import('../../src/commands/pr-review.js');

describe('/pr-review command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('exports correct metadata', () => {
    expect(metadata.command).toBe('/pr-review');
    expect(metadata.implemented).toBe(true);
    expect(metadata.description).toContain('pull request');
  });

  it('queues instructions silently and returns null in interactive mode', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', queueInstruction };

    const result = await prReview(ctx as any);

    expect(result).toBeNull();
    expect(queueInstruction).toHaveBeenCalledOnce();
    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Pull Request Review Target');
    expect(queued).toContain('/tmp/test');
    expect(queued).toContain('gh pr list');
    expect(queued).toContain('gh pr diff');
  });

  it('includes the PR selector when provided', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', queueInstruction };

    await prReview(ctx as any, ['482']);

    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('PR selector: 482');
    expect(queued).toContain('gh pr view 482');
    expect(queued).toContain('gh pr diff 482');
  });

  it('includes additional focus when provided', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', queueInstruction };

    await prReview(ctx as any, ['482', 'focus', 'on', 'tests']);

    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Additional Focus');
    expect(queued).toContain('focus on tests');
  });

  it('returns prompt text in non-interactive mode', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', queueInstruction, isNonInteractive: true };

    const result = await prReview(ctx as any, ['482']);

    expect(typeof result).toBe('string');
    expect(result).toContain('gh pr view 482');
    expect(queueInstruction).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('prints a short status message in interactive mode', async () => {
    const ctx = { workspaceRoot: '/tmp/test', queueInstruction: vi.fn() };

    await prReview(ctx as any, ['482']);

    const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain('Starting pull request review');
    expect(output).toContain('PR selector: 482');
  });
});
