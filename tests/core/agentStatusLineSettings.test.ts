/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_LINE_SETTINGS,
  buildStatusLineExtension,
  formatStatusLineLeft,
  resolveStatusLineSettings,
} from '../../src/core/agent/StatusLineSettings.js';

describe('status line settings', () => {
  it('keeps context, command hints, and PR visible by default', () => {
    expect(resolveStatusLineSettings(undefined)).toEqual(DEFAULT_STATUS_LINE_SETTINGS);

    const left = formatStatusLineLeft({
      contextPercentLeft: 53,
      commandHint: '? shortcuts · / commands',
      queueCount: 0,
      settings: resolveStatusLineSettings(undefined),
    });

    expect(left).toContain('53% context left');
    expect(left).toContain('? shortcuts');
    expect(left).toContain('PR #123');
  });

  it('can hide individual default fields', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 53,
      commandHint: '? shortcuts · / commands',
      queueCount: 0,
      settings: resolveStatusLineSettings({
        showContext: false,
        showCommandHint: false,
        showPullRequest: false,
      }),
    });

    expect(left).not.toContain('context left');
    expect(left).not.toContain('? shortcuts');
    expect(left).not.toContain('PR #123');
  });

  it('shows session added and removed line counts when enabled', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 88,
      commandHint: '/ commands',
      queueCount: 0,
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      sessionDiffStats: { added: 12, removed: 3 },
    });

    expect(left).toContain('+12 lines');
    expect(left).toContain('-3 lines');
  });

  it('builds Ink line extensions from the same configured fields', () => {
    const extension = buildStatusLineExtension({
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      pullRequestNumber: 456,
      sessionDiffStats: { added: 2, removed: 1 },
    });

    expect(extension?.status?.segments?.map((segment) => segment.text)).toEqual([
      'PR #456',
      '+2 lines',
      '-1 lines',
    ]);
  });
});
