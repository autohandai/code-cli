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
    expect(queueInstruction).toHaveBeenCalledWith(expect.any(String), undefined, {
      environmentBootstrap: 'skip', intent: 'diagnostic',
    });
    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Pull Request Review Target');
    expect(queued).toContain('/tmp/test');
    expect(queued).toContain('Target: local working tree');
    expect(queued).toContain('git diff --no-ext-diff HEAD --');
    expect(queued).not.toContain('gh pr list');
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

  it('keeps review read-only and requires confidence and concrete evidence', async () => {
    const result = await prReview({ workspaceRoot: '/repo', isNonInteractive: true }, ['staged']);

    expect(result).toContain('git diff --no-ext-diff --cached --');
    expect(result).toContain('Do not edit files, commit, push, post comments, or submit a GitHub review');
    expect(result).toContain('confidence');
    expect(result).toContain('file:line');
    expect(result).toContain('reviewer');
    expect(result).toContain('security-auditor');
    expect(result).toContain('tester');
  });

  it.each(['482; touch /tmp/unrelated', '--repo', 'https://example.com/pull/482'])('rejects an unsafe or ambiguous selector %s', async (selector) => {
    const queueInstruction = vi.fn();
    const result = await prReview({ workspaceRoot: '/repo', queueInstruction }, [selector]);

    expect(result).toContain('Usage: /pr-review');
    expect(queueInstruction).not.toHaveBeenCalled();
  });
});
