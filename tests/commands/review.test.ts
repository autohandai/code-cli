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
        'description: test specialist',
        'tools: read_file, fff_grep, fff_find',
        '---',
        '',
        '# Autohand Review',
        '### Executive view',
        '### Technical findings',
        '### Forensic appendix',
        '### Evidence boundary',
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
    expect(metadata.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'changes',
      'code',
      'architecture',
      'security',
      'performance',
      'forensics',
    ]);
  });

  it('queues instructions silently and returns null when queueInstruction is available', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    const result = await review(ctx as any);

    expect(result).toBeNull();
    expect(queueInstruction).toHaveBeenCalledOnce();
    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('Autohand Review');
    expect(queued).toContain('"kind": "changes"');
    expect(queued).toContain('"workspaceRoot": "/tmp/test"');
  });

  it('shows a brief status message to the user', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };

    await review(ctx as any);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Starting Autohand Review');
    expect(output).toContain('changes');
  });

  it('shows user focus in the status message', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };

    await review(ctx as any, ['--focus', 'security']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('security');
  });

  it('includes user instructions in the queued prompt', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    await review(ctx as any, ['--focus', 'check', 'error', 'handling']);

    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('"focus": "check error handling"');
  });

  it('parses advanced review subcommands through the shared request contract', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    await review(ctx as any, [
      'architecture',
      'packages/api',
      '--audience',
      'technical',
      '--base',
      'origin/main',
    ]);

    const queued = queueInstruction.mock.calls[0][0];
    expect(queued).toContain('"kind": "architecture"');
    expect(queued).toContain('"target": "packages/api"');
    expect(queued).toContain('"audience": "technical"');
    expect(queued).toContain('"base": "origin/main"');
  });

  it('returns review help without queueing a turn', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    const result = await review(ctx as any, ['help']);

    expect(result).toContain('/review architecture');
    expect(result).toContain('autohand review security');
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('rejects invalid review options without queueing a turn', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction };

    const result = await review(ctx as any, ['security', '--audience', 'unknown']);

    expect(result).toContain('Invalid review audience');
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('loads the Autohand Review specialist contract', async () => {
    const fse = (await import('fs-extra')).default;
    const queueInstruction = vi.fn();

    await review({ workspaceRoot: '/tmp/test', config: {}, queueInstruction } as any);

    expect(fse.readFile).toHaveBeenCalledWith(
      expect.stringContaining('agents/builtin/autohand-review.md'),
      'utf-8',
    );
  });

  it('falls back to returning prompt text when queueInstruction is unavailable', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {} };

    const result = await review(ctx as any);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Autohand Review');
  });

  it('falls back gracefully if the bundled specialist definition is missing', async () => {
    const fse = (await import('fs-extra')).default;
    (fse.readFile as any).mockRejectedValueOnce(new Error('ENOENT'));
    (fse.readFile as any).mockRejectedValueOnce(new Error('ENOENT'));

    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction: vi.fn() };
    await review(ctx as any);

    const queued = (ctx.queueInstruction as any).mock.calls[0][0];
    expect(queued).toContain('Autohand Review');
    expect(queued).toContain('evidence-led');
  });

  it('returns prompt text in RPC/ACP mode (isNonInteractive) even when queueInstruction exists', async () => {
    const queueInstruction = vi.fn();
    const ctx = { workspaceRoot: '/tmp/test', config: {}, queueInstruction, isNonInteractive: true };

    const result = await review(ctx as any);

    // In non-interactive mode, should return the prompt (not queue it)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Autohand Review');
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
