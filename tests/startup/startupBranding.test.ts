/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { countStartupWorkspacePeers, getStartupGitLabel, getStartupLogoRows, StartupBranding } from '../../src/startup/startupBranding.js';
import { renderAutohandLogo } from '../../src/utils/asciiArt.js';

function terminal(isTTY = true) {
  return { isTTY, write: vi.fn(() => true) };
}

describe('startup branding', () => {
  const footer = 'Autohand (OpenRouter, openai/gpt-4o-mini) · 100% context left · ? shortcuts · / commands · @ mention files · $ skills · : message agents · ! terminal · /var/folders/t1/2g8dxm…tory-example/workspace · main · PR #123';
  const welcome = ['> Autohand v0.8.2 (1e913c40)', 'Describe a task, or use /help to see commands.', ''];

  it('counts matching local peers and clears its first-paint deadline', async () => {
    vi.useFakeTimers();
    try {
      const baseline = vi.getTimerCount();
      const count = await countStartupWorkspacePeers('/workspace/app', async () => [
        { workspaceRoot: '/workspace/app' }, { workspaceRoot: '/workspace/app/.' }, { workspaceRoot: '/workspace/other' },
      ]);
      expect(count).toBe(2);
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stalled optional peer scan delay the first banner', async () => {
    vi.useFakeTimers();
    try {
      const baseline = vi.getTimerCount();
      const count = countStartupWorkspacePeers('/workspace/app', () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(100);
      expect(await count).toBe(0);
      expect(vi.getTimerCount()).toBe(baseline);
      expect(await countStartupWorkspacePeers('/workspace/app', async () => { throw new Error('registry unavailable'); })).toBe(0);
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('reads the branch locally for a nested workspace with a worktree pointer: %s', async (worktree) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autohand-branding-git-'));
    try {
      const gitDirectory = path.join(root, worktree ? 'git-worktree' : '.git');
      await mkdir(gitDirectory);
      if (worktree) await writeFile(path.join(root, '.git'), 'gitdir: git-worktree\n');
      await writeFile(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n');
      const workspace = path.join(root, 'packages', 'app');
      await mkdir(workspace, { recursive: true });

      expect(getStartupGitLabel(workspace)).toBe('main');
      await writeFile(path.join(gitDirectory, 'HEAD'), '1234567890abcdef\n');
      expect(getStartupGitLabel(workspace)).toBe('1234567');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { columns: 80, rows: 24, expectedLogoRows: 10 },
    { columns: 120, rows: 32, expectedLogoRows: 12 },
  ])('keeps the complete returning logo above the composer at $columns×$rows', ({ columns, rows, expectedLogoRows }) => {
    const availableRows = getStartupLogoRows({ columns, rows, welcomeLines: welcome, footerText: footer });
    const logo = renderAutohandLogo({ columns, rows: availableRows });

    expect(logo.split('\n')).toHaveLength(expectedLogoRows);
  });

  it('reserves wrapped welcome announcements, greetings, and peer metadata before selecting art', () => {
    const availableRows = getStartupLogoRows({
      columns: 80,
      rows: 24,
      footerText: footer,
      welcomeLines: [
        ...welcome,
        'Welcome back, Test User!',
        '1 other session in this workspace',
        ' ◆ Announcement: ' + 'a'.repeat(100),
        'Read the release notes for details.',
      ],
    });

    expect(availableRows).toBe(5);
    expect(renderAutohandLogo({ columns: 80, rows: availableRows })).toBe('autohand');
  });

  it('omits returning art when the welcome and composer already consume the viewport', () => {
    expect(getStartupLogoRows({ columns: 32, rows: 8, welcomeLines: welcome, footerText: footer })).toBe(0);
  });

  it('prints the shared logo on a fresh authenticated terminal launch', () => {
    const branding = new StartupBranding();
    const output = terminal();
    const renderLogo = vi.fn(() => 'brand geometry');

    branding.printBanner({ output, renderLogo });

    expect(output.write.mock.calls.map(([text]) => text).join(''))
      .toBe('\x1b[3J\x1b[2J\x1b[Hbrand geometry\n');
    expect(renderLogo).toHaveBeenCalledOnce();
  });

  it('preserves the login screen and authorization evidence without printing a second logo', () => {
    const branding = new StartupBranding();
    const output = terminal();
    const renderLogo = vi.fn(() => 'duplicate logo');

    branding.onLoginPromptShown();
    branding.printBanner({ output, renderLogo });

    expect(output.write).not.toHaveBeenCalled();
    expect(renderLogo).not.toHaveBeenCalled();
  });

  it('keeps login branding state isolated to the current process owner', () => {
    const authenticatedAfterLogin = new StartupBranding();
    authenticatedAfterLogin.onLoginPromptShown();
    const signedInLaunch = new StartupBranding();
    const output = terminal();

    signedInLaunch.printBanner({ output, renderLogo: () => 'brand geometry' });

    expect(output.write).toHaveBeenCalledWith('brand geometry\n');
  });

  it('keeps redirected output plain and respects the existing no-banner setting', () => {
    const branding = new StartupBranding();
    const output = terminal(false);
    const renderLogo = vi.fn(() => 'terminal art');

    branding.printBanner({ output, renderLogo });
    expect(output.write).toHaveBeenCalledExactlyOnceWith('autohand\n');
    expect(renderLogo).not.toHaveBeenCalled();
    output.write.mockClear();

    branding.printBanner({ output, renderLogo, disabled: true });
    expect(output.write).not.toHaveBeenCalled();
  });
});
