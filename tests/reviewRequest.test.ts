/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  REVIEW_AUDIENCES,
  REVIEW_KINDS,
  buildReviewInstruction,
  formatReviewHelp,
  parseReviewArguments,
} from '../src/review/reviewRequest.js';

describe('review request parsing', () => {
  it('defaults to a mixed-audience working-tree review', () => {
    expect(parseReviewArguments([])).toEqual({
      ok: true,
      request: {
        kind: 'changes',
        audience: 'mixed',
        format: 'markdown',
      },
    });
  });

  it.each(REVIEW_KINDS)('accepts the %s review subcommand', (kind) => {
    expect(parseReviewArguments([kind])).toEqual({
      ok: true,
      request: {
        kind,
        audience: 'mixed',
        format: 'markdown',
      },
    });
  });

  it.each(REVIEW_AUDIENCES)('accepts the %s audience', (audience) => {
    const parsed = parseReviewArguments(['security', '--audience', audience]);

    expect(parsed).toEqual({
      ok: true,
      request: {
        kind: 'security',
        audience,
        format: 'markdown',
      },
    });
  });

  it('parses a bounded comparison and multi-word focus', () => {
    expect(parseReviewArguments([
      'architecture',
      'packages/api',
      '--base',
      'origin/main',
      '--head=feature/review',
      '--focus',
      'authorization',
      'and',
      'tenant',
      'boundaries',
      '--format',
      'json',
      '--audience=forensic',
    ])).toEqual({
      ok: true,
      request: {
        kind: 'architecture',
        audience: 'forensic',
        format: 'json',
        target: 'packages/api',
        base: 'origin/main',
        head: 'feature/review',
        focus: 'authorization and tenant boundaries',
      },
    });
  });

  it('treats a lone path as a code review target', () => {
    expect(parseReviewArguments(['src/auth.ts'])).toEqual({
      ok: true,
      request: {
        kind: 'code',
        audience: 'mixed',
        format: 'markdown',
        target: 'src/auth.ts',
      },
    });
  });

  it.each([
    { args: ['security', '--audience', 'board'], error: 'Invalid review audience' },
    { args: ['security', '--format', 'xml'], error: 'Invalid review format' },
    { args: ['security', '--base'], error: '--base requires a value' },
    { args: ['security', '--unknown'], error: 'Unknown review option' },
    { args: ['code', 'src/a.ts', 'src/b.ts'], error: 'one target' },
  ])('rejects invalid arguments: $args', ({ args, error }) => {
    const parsed = parseReviewArguments(args);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(error);
  });

  it('returns dedicated help for slash-command discovery', () => {
    const parsed = parseReviewArguments(['help']);

    expect(parsed).toEqual({ ok: true, help: true });
    expect(formatReviewHelp()).toContain('/review architecture');
    expect(formatReviewHelp()).toContain('autohand review security');
  });
});

describe('review instruction construction', () => {
  it('combines the specialist contract with a structured, read-only request', () => {
    const parsed = parseReviewArguments([
      'forensics',
      'packages/runtime',
      '--base',
      'v1.2.0',
      '--focus',
      'shutdown race',
    ]);
    if (!parsed.ok || 'help' in parsed) throw new Error('Expected a review request');

    const instruction = buildReviewInstruction({
      request: parsed.request,
      workspaceRoot: '/workspace/product',
      specialistInstructions: [
        '# Autohand Review',
        '### Executive view',
        '### Technical findings',
        '### Forensic appendix',
        '### Evidence boundary',
      ].join('\n'),
    });

    expect(instruction).toContain('Autohand Review');
    expect(instruction).toContain('read-only');
    expect(instruction).toContain('"kind": "forensics"');
    expect(instruction).toContain('"target": "packages/runtime"');
    expect(instruction).toContain('"base": "v1.2.0"');
    expect(instruction).toContain('"focus": "shutdown race"');
    expect(instruction).toContain('"workspaceRoot": "/workspace/product"');
    expect(instruction).toContain('Trace the incident or change history');
    expect(instruction).toContain('Executive view');
    expect(instruction).toContain('Technical findings');
    expect(instruction).toContain('Forensic appendix');
    expect(instruction).toContain('Evidence boundary');
  });

  it('requires machine-readable output without weakening evidence rules', () => {
    const parsed = parseReviewArguments(['security', '--format', 'json']);
    if (!parsed.ok || 'help' in parsed) throw new Error('Expected a review request');

    const instruction = buildReviewInstruction({
      request: parsed.request,
      workspaceRoot: '/workspace/product',
      specialistInstructions: '# Autohand Review',
    });

    expect(instruction).toContain('Return one valid JSON object');
    expect(instruction).toContain('Do not invent findings');
  });
});
