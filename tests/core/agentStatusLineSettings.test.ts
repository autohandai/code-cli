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
  formatWorkspacePathSegment,
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

  it('uses the token usage context segment when live usage is available', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 85,
      contextStatus: 'context: 7.4% (19.3k/262.1k)',
      commandHint: '? shortcuts · / commands',
      queueCount: 0,
      settings: resolveStatusLineSettings(undefined),
    });

    expect(left).toContain('context: 7.4% (19.3k/262.1k)');
    expect(left).not.toContain('85% context left');
  });

  it('shows bounded workspace and git labels when enabled', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 85,
      commandHint: '? shortcuts · / commands',
      queueCount: 0,
      workspaceRoot: '/Users/igor/Documents/autohand/new/commander',
      homeDir: '/Users/igor',
      gitLabel: 'main',
      settings: resolveStatusLineSettings(undefined),
    });

    expect(left).toContain('~/Documents/autohand/new/commander');
    expect(left).toContain('main');
  });

  it('truncates long workspace paths from the middle', () => {
    expect(
      formatWorkspacePathSegment(
        '/Users/igor/Documents/autohand/some/really/deep/project/commander',
        { homeDir: '/Users/igor', limit: 28 }
      )
    ).toBe('~/Documents/au…ect/commander');
  });

  it('can hide individual default fields', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 53,
      contextStatus: 'context: 7.4% (19.3k/262.1k)',
      commandHint: '? shortcuts · / commands',
      queueCount: 0,
      workspaceRoot: '/Users/igor/Documents/autohand/new/commander',
      homeDir: '/Users/igor',
      gitLabel: 'main',
      settings: resolveStatusLineSettings({
        showProviderModel: false,
        showContext: false,
        showWorkspacePath: false,
        showGitBranch: false,
        showCommandHint: false,
        showPullRequest: false,
      }),
    });

    expect(left).not.toContain('context left');
    expect(left).not.toContain('~/Documents');
    expect(left).not.toContain('main');
    expect(left).not.toContain('? shortcuts');
    expect(left).not.toContain('PR #123');
  });

  it('can hide queued request counts', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 53,
      commandHint: '? shortcuts · / commands',
      queueCount: 4,
      settings: resolveStatusLineSettings({ showQueue: false }),
    });

    expect(left).not.toContain('queued');
  });

  it('shows session added and removed line counts when enabled', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 88,
      commandHint: '/ commands',
      queueCount: 0,
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      sessionDiffStats: { added: 12, removed: 3 },
      sessionHasFileChanges: true,
    });

    expect(left).toContain('+12 lines');
    expect(left).toContain('-3 lines');
  });

  it('hides session line counts during turns that have not changed files', () => {
    const left = formatStatusLineLeft({
      contextPercentLeft: 88,
      commandHint: '/ commands',
      queueCount: 0,
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      sessionDiffStats: { added: 117, removed: 20 },
      sessionHasFileChanges: false,
    });

    expect(left).not.toContain('+117 lines');
    expect(left).not.toContain('-20 lines');
  });

  it('builds Ink help-line extensions from the same configured fields', () => {
    const extension = buildStatusLineExtension({
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      workspaceRoot: '/Users/igor/Documents/autohand/new/commander',
      homeDir: '/Users/igor',
      gitLabel: 'main',
      pullRequestNumber: 456,
      sessionDiffStats: { added: 2, removed: 1 },
      sessionHasFileChanges: true,
    });

    expect(extension?.status).toBeUndefined();
    expect(extension?.help?.segments?.map((segment) => segment.text)).toEqual([
      '~/Documents/autohand/new/commander',
      'main',
      'PR #456',
      '+2 lines',
      '-1 lines',
    ]);
  });

  it('hides Ink help-line defaults for disabled context and command hints', () => {
    const extension = buildStatusLineExtension({
      settings: resolveStatusLineSettings({
        showProviderModel: false,
        showContext: false,
        showWorkspacePath: false,
        showGitBranch: false,
        showCommandHint: false,
        showPullRequest: false,
      }),
      workspaceRoot: '/Users/igor/Documents/autohand/new/commander',
      homeDir: '/Users/igor',
      gitLabel: 'main',
    });

    expect(extension?.help?.hiddenDefaultSegmentIds).toEqual(['provider', 'context', 'command-hint']);
    expect(extension?.help?.segments).toEqual([]);
  });

  it('hides Ink active-turn status segments from configured fields', () => {
    const extension = buildStatusLineExtension({
      settings: resolveStatusLineSettings({
        showActiveStatus: false,
        showActiveMetrics: false,
        showQueue: false,
        showCancelHint: false,
      }),
    });

    expect(extension?.status?.hiddenDefaultSegmentIds).toEqual(['status', 'metrics', 'queue', 'cancel']);
  });

  it('omits Ink help-line session counts when the active turn has no file changes', () => {
    const extension = buildStatusLineExtension({
      settings: resolveStatusLineSettings({ showSessionLines: true }),
      pullRequestNumber: 456,
      sessionDiffStats: { added: 117, removed: 20 },
      sessionHasFileChanges: false,
    });

    expect(extension?.help?.segments?.map((segment) => segment.text)).toEqual(['PR #456']);
  });
});
