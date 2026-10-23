import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { ShortcutsHelpPanel } from '../../../src/ui/ink/ShortcutsHelpPanel.js';
import { resolveKeybindings } from '../../../src/keybindings/profiles.js';

afterEach(cleanup);

describe('shortcut help', () => {
  it.each([false, true])('shows the fixed queue steering shortcut with fullScreen=%s', async fullScreen => {
    const view = render(<ThemeProvider><ShortcutsHelpPanel visible fullScreen={fullScreen} columns={100} /></ThemeProvider>);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stripAnsi(view.lastFrame() ?? '')).toMatch(/ctrl\s*\+\s*enter[^\n]*Steer queued input/i);
  });

  it('groups shortcuts into aligned columns on wide terminals', async () => {
    const view = render(<></>);
    Object.defineProperty(view.stdout, 'columns', { value: 140 });
    view.rerender(<ThemeProvider><ShortcutsHelpPanel visible fullScreen columns={140} /></ThemeProvider>);
    await new Promise(resolve => setTimeout(resolve, 40));
    const screen = stripAnsi(view.lastFrame() ?? '');
    await expect(screen).toMatchFileSnapshot('../../../src/testing/snapshots/shortcut-help-wide.txt');
    const lines = screen.split('\n');
    const headings = lines.find(line => line.includes('Compose'));
    expect(headings).toContain('Session');
    expect(headings).toContain('Transcript');
    expect(lines.find(line => line.includes('Commands'))!.indexOf('Commands')).toBe(lines.find(line => line.includes('New line'))!.indexOf('New line'));
    expect(lines.join('\n')).toContain('ctrl+f');
    expect(lines.join('\n')).toContain('Steer selected message');
  });

  it('wraps narrow help without losing active profile bindings', async () => {
    const view = render(<ThemeProvider><ShortcutsHelpPanel visible columns={36} keybindings={resolveKeybindings('codex')} /></ThemeProvider>);
    await new Promise(resolve => setTimeout(resolve, 40));
    const screen = stripAnsi(view.lastFrame() ?? '');
    expect(screen).toContain('ctrl + j');
    expect(screen).toContain('ctrl + d');
    expect(screen).toContain('ctrl + r');
    expect(screen).not.toContain('ctrl+f');
    for (const line of screen.split('\n')) expect(line.length).toBeLessThanOrEqual(34);
  });
});
