/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { StatusLine, formatLineSegments, mergeLineExtensions } from '../../../src/ui/ink/StatusLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

function renderStatusLine(props: React.ComponentProps<typeof StatusLine>) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <StatusLine {...props} />
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('StatusLine extensions', () => {
  it('uses the theme ANSI formatter for status segments and separators', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/StatusLine.tsx'),
      'utf8'
    );

    expect(source).toContain("theme.fg('muted', separator)");
    expect(source).toContain('theme.fg(getSegmentToken(segment.color), normalizeSegmentText(segment))');
  });

  it('shows the account plan while idle so it is always visible', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: false,
      status: '',
      plan: { tier: 'pro', label: 'Pro', interval: 'month' },
    });

    expect(lastFrame()).toContain('Pro');
    expect(lastFrame()).toContain('Monthly');
  });

  it('names the annual cycle when the account renews yearly', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: false,
      status: '',
      plan: { tier: 'max', label: 'Max', interval: 'year' },
    });

    expect(lastFrame()).toContain('Max');
    expect(lastFrame()).toContain('Annual');
  });

  it('shows a free plan without inventing a billing cycle', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: false,
      status: '',
      plan: { tier: 'free', label: 'Free', interval: null },
    });

    expect(lastFrame()).toContain('Free');
    expect(lastFrame()).not.toContain('Monthly');
    expect(lastFrame()).not.toContain('Annual');
  });

  it('keeps the plan visible alongside a working status', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Compiling...',
      plan: { tier: 'pro', label: 'Pro', interval: 'month' },
    });

    expect(lastFrame()).toContain('Compiling...');
    expect(lastFrame()).toContain('Pro');
  });

  it('renders nothing extra when the plan is unknown', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: false,
      status: '',
    });

    expect(lastFrame()).not.toContain('Monthly');
    expect(lastFrame()).not.toContain('Annual');
  });

  it('keeps the rotating activity verb in the active status line', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Compiling...',
      elapsed: '5s',
      tokens: '120 tokens',
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Compiling...');
    expect(frame).toContain('5s');
    expect(frame).toContain('120 tokens');
    expect(frame).toContain('esc to cancel');
  });

  it('shows ambient team progress while the lead is idle', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: false,
      status: '',
      teamActivity: {
        team: {
          name: 'prompt-shrink',
          createdAt: '2026-08-17T00:00:00.000Z',
          leadSessionId: 'lead-1',
          status: 'active',
          members: [
            { name: 'planner', agentName: 'planner', pid: 101, status: 'working' },
            { name: 'reviewer', agentName: 'reviewer', pid: 102, status: 'idle' },
          ],
        },
        tasks: [
          { id: 'task-1', subject: 'Plan', description: '', status: 'completed', blockedBy: [], createdAt: '' },
          { id: 'task-2', subject: 'Review', description: '', status: 'in_progress', blockedBy: [], createdAt: '' },
          { id: 'task-3', subject: 'Ship', description: '', status: 'pending', blockedBy: [], createdAt: '' },
        ],
      },
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('prompt-shrink');
    expect(frame).toContain('1/3 done');
    expect(frame).toContain('1 working');
    expect(frame).toContain('cmd+t');
  });

  it('appends custom status segments after default active-turn chrome', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Working',
      elapsed: '5s',
      tokens: '120 tokens',
      lineExtension: {
        segments: [{ id: 'mode', text: 'plan:on' }],
      },
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Working');
    expect(frame).toContain('5s');
    expect(frame).toContain('120 tokens');
    expect(frame).toContain('plan:on');
  });

  it('can replace default status segments', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Working',
      lineExtension: {
        replaceDefault: true,
        segments: [{ id: 'custom', text: 'custom status' }],
      },
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('custom status');
    expect(frame).not.toContain('Working');
  });

  it('can hide selected default line segments while preserving the rest', () => {
    const line = formatLineSegments(
      [
        { id: 'provider', text: 'autohand (Ollama)' },
        { id: 'context', text: '66% context left' },
        { id: 'command-hint', text: '/ commands' },
      ],
      {
        hiddenDefaultSegmentIds: ['context'],
        segments: [{ id: 'pull-request', text: 'PR #123' }],
      }
    );

    expect(line).toBe('autohand (Ollama) · / commands · PR #123');
  });

  it('merges configured and extension-provided line segments', () => {
    const merged = mergeLineExtensions(
      {
        hiddenDefaultSegmentIds: ['context'],
        segments: [{ id: 'pull-request', text: 'PR #123' }],
      },
      {
        segments: [{ id: 'extension-mode', text: 'team:on' }],
      }
    );

    expect(formatLineSegments(
      [
        { id: 'provider', text: 'autohand (Ollama)' },
        { id: 'context', text: '66% context left' },
      ],
      merged
    )).toBe('autohand (Ollama) · PR #123 · team:on');
  });

  it('does not crash when an extension passes a non-string segment at runtime', () => {
    const line = formatLineSegments(
      [],
      {
        segments: [{ id: 'context', text: { used: 19_300, total: 262_144 } as unknown as string }],
      }
    );

    expect(line).toBe('[object Object]');
  });
});
