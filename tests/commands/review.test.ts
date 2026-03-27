/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /review slash command:
 * - Metadata correctness
 * - Skill body loading and prompt assembly
 * - User instruction incorporation
 * - Graceful fallback when SKILL.md is missing
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports correct metadata', () => {
    expect(metadata.command).toBe('/review');
    expect(metadata.implemented).toBe(true);
    expect(metadata.description).toContain('review');
  });

  it('returns skill body as instructions when called without args', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {} };

    const result = await review(ctx as any);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Staff-level Software Engineer');
    expect(result).toContain('Review Target');
    expect(result).toContain('/tmp/test');
  });

  it('incorporates user instructions from args', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {} };

    const result = await review(ctx as any, ['focus', 'on', 'security']);

    expect(result).toContain('Additional Focus');
    expect(result).toContain('focus on security');
  });

  it('includes instructions to start the review', async () => {
    const ctx = { workspaceRoot: '/tmp/test', config: {} };

    const result = await review(ctx as any);

    expect(result).toContain('Start the review now');
    expect(result).toContain('read_file');
  });

  it('falls back gracefully if SKILL.md is missing', async () => {
    const fse = (await import('fs-extra')).default;
    (fse.readFile as any).mockRejectedValueOnce(new Error('ENOENT'));

    const ctx = { workspaceRoot: '/tmp/test', config: {} };
    const result = await review(ctx as any);

    expect(result).toBeTruthy();
    expect(result).toContain('code review');
  });
});
