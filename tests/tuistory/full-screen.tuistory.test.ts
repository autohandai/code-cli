/** @license Apache-2.0 */
import { renderAutohandLogo } from '../../src/utils/asciiArt.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { isTerminalMouseTrackingEnabled } from '../../src/testing/scenarios/mouseScrollbackScenario.js';
import { composerCaretLine } from '../../src/testing/assertions/composerCaret.js';
import { clickFullScreenComposer, seedFullScreenHistory, startFullScreenHeaderProbe, typeMultilineDraft, runFullScreenLiveOutputScenario } from '../../src/testing/scenarios/fullScreenScenario.js';
import { launchTuistorySession } from '../../src/testing/drivers/tuistory-driver.js';
import { outputViewport, LONG_OUTPUT_COMMAND, runLongOutputTurn } from '../../src/testing/scenarios/compactOutputScenario.js';
import { createMockAuthServer, type MockAuthServer, createMockAutohandAINativeSequenceServer, type MockNativeToolServer, createTempAutohandHome, launchBuiltAutohand, exitInteractive, type TuistoryTempState } from './helpers/autohandTuistory.js';
let server: MockNativeToolServer | undefined;
let auth: MockAuthServer | undefined;
let state: TuistoryTempState | undefined;
let session: Session | undefined;
afterEach(async () => { session?.close(); await server?.close(); await auth?.close(); auth = undefined; server = undefined; await state?.cleanup(); session = undefined; state = undefined; });

describe('full-screen terminal', () => {
  it('expands live output from history and retains user-message highlighting through resize', async () => {
    state = await createTempAutohandHome();
    session = await launchTuistorySession({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve('src/testing/scenarios/fullScreenLiveOutputPtyScenario.tsx')],
      cwd: process.cwd(),
      cols: 80, rows: 30, waitForDataTimeout: 15_000,
      env: { ...process.env, AUTOHAND_HOME: state.autohandHome, CI: 'false', TERM: 'xterm-256color', FORCE_COLOR: '3', NO_COLOR: undefined },
    });
    const screens = await runFullScreenLiveOutputScenario(session);
    expect(screens.highlightedBefore).toContain('❯ thanks');
    expect(screens.highlightedBefore).not.toContain('fixture-history-50');
    expect(screens.expanded).toContain('live-row-1\n');
    expect(screens.expanded).toContain('Ctrl+O collapse');
    expect(screens.paged).not.toContain('live-row-1\n');
    expect(screens.resized).toContain('preserved draft');
    expect(screens.collapsed).toContain('Ctrl+O expand');
    expect(screens.collapsed).toContain('live-row-60');
    expect(screens.highlightedAfter).toContain('❯ thanks');
    await exitInteractive(session);
    expect(session.getRawOutput()).toContain('FULL_SCREEN_PTY_EXIT');
  });

  it('shows product identity at the top and navigation below the composer status', async () => {
    server = await createMockAutohandAINativeSequenceServer([{ content: 'HEADER_WORK_DONE', delayMs: 1500 }]);
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', baseUrl: server.baseUrl },
      features: { fullScreenMode: true, autohand_inference: true },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0 },
      ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 180, rows: 40,
    });
    await session.waitForText('❯'); await session.waitIdle();
    const lines = outputViewport(session).split('\n');
    expect(lines[0]).toMatch(/Autohand Code \(v\d+\.\d+\.\d+/);
    expect(lines[1]).toContain(state.workspaceRoot);
    const composerRow = lines.findLastIndex(line => line.includes('❯'));
    const statusRow = lines.findIndex(line => line.includes('context left'));
    const navigationRow = lines.findIndex(line => line.includes('Full screen · Latest'));
    expect(statusRow).toBeGreaterThan(composerRow);
    expect(navigationRow).toBeGreaterThan(statusRow);
    expect(navigationRow).toBeGreaterThanOrEqual(37);
    await startFullScreenHeaderProbe(session);
    const workingLines = outputViewport(session).split('\n');
    expect(workingLines[2]).not.toContain('esc to cancel');
    expect(workingLines.findIndex(line => line.includes('esc to cancel'))).toBeGreaterThan(2);
    expect(workingLines.filter(line => line.includes('esc to cancel'))).toHaveLength(1);
    expect(workingLines.findLastIndex(line => line.includes('❯'))).toBe(composerRow);
    await session.waitForText('HEADER_WORK_DONE', { timeout: 15_000 });
    await exitInteractive(session);
    expect(session.getRawOutput()).toContain('\x1b[?1049l');
  });
  it('places the hardware caret inside the composer on a tall empty screen and after resize', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: undefined }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
      cols: 180, rows: 58, env: { TERM_PROGRAM: 'ghostty' },
    });
    await session.waitForText('❯');
    await session.type('aka'); await session.waitForText('❯ aka');
    expect(composerCaretLine(session)).toBe('❯ aka|');
    await session.resize({ cols: 80, rows: 24 });
    await expect.poll(() => composerCaretLine(session)).toBe('❯ aka|');
    await session.press('left'); await session.type('X'); await session.waitForText('❯ akXa');
    expect(composerCaretLine(session)).toBe('❯ akX|a');
    await exitInteractive(session);
  });

  it.each([140, 80, 48])('opens shortcut help above an anchored composer at %i columns', async (columns) => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: columns, rows: 40,
    });
    await session.waitForText('❯');
    const composerRow = () => outputViewport(session!).split('\n').findIndex(line => line.includes('❯'));
    await session.waitIdle();
    const baseline = composerRow();
    await session.type('?');
    await session.waitForText('Keyboard shortcuts');
    await session.waitIdle();
    expect(composerRow()).toBe(baseline);
    const screen = outputViewport(session).split('\n');
    expect(screen.findIndex(line => line.includes('Keyboard shortcuts'))).toBeLessThan(baseline);
    if (columns >= 110) {
      expect(screen.find(line => line.includes('Compose'))).toContain('Session');
      expect(screen.find(line => line.includes('Compose'))).toContain('Transcript');
      expect(screen.find(line => line.includes('/whatityped'))).toMatch(/\/whatityped\s+Typed history/);
    }
    expect(composerCaretLine(session)).toMatch(/^❯ \|/);
    await session.type('?');
    await session.type('still editable');
    await session.waitForText('❯ still editable');
    expect(composerRow()).toBe(baseline);
    expect(composerCaretLine(session)).toBe('❯ still editable|');
    await exitInteractive(session);
  });

  it('opens the slash menu above the composer and keeps the status bar at the bottom', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 100, rows: 30,
    });
    await session.waitForText('❯'); await session.waitIdle();
    const lines = () => outputViewport(session!).split('\n');
    const baseline = lines().findIndex(line => line.includes('❯'));
    await session.type('/'); await session.waitForText('/about'); await session.waitIdle();
    expect(lines().findIndex(line => line.includes('❯ /'))).toBe(baseline);
    expect(lines().findIndex(line => line.includes('/about'))).toBeLessThan(baseline);
    await session.press('esc'); await session.press('backspace'); await session.type('menu closed');
    await session.waitForText('❯ menu closed');
    await expect.poll(() => composerCaretLine(session)).toBe('❯ menu closed|');
    await exitInteractive(session);
  });

  it('supports mouse editing and wheel scrolling without losing the draft', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false, keybindingProfile: 'codex' } } });
    await seedFullScreenHistory(state.autohandHome, state.workspaceRoot);
    session = await launchBuiltAutohand(['resume', 'full-screen-history', '--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 100, rows: 30, env: { TERM_PROGRAM: 'ghostty' },
    });
    await session.waitForText('History item 79');
    await session.type('hello'); await session.waitIdle();
    expect(isTerminalMouseTrackingEnabled(session)).toBe(true);
    const lines = outputViewport(session).split('\n');
    const row = lines.findIndex(line => line.includes('❯ hello'));
    await clickFullScreenComposer(session, 4, row);
    await session.type('X');
    await session.waitForText('❯ heXllo');
    await session.scrollUp(3, 5, 3); await session.waitIdle();
    expect(outputViewport(session)).toContain('Ctrl+End latest');
    expect(outputViewport(session)).toContain('heXllo');
    expect(isTerminalMouseTrackingEnabled(session)).toBe(true);
    await session.press(['ctrl', 'c']);
    await typeMultilineDraft(session, Array.from({ length: 10 }, (_, index) => `line-${index}`));
    await session.waitForText('line-9'); await session.waitIdle();
    const targetRow = outputViewport(session).split('\n').findIndex(line => line.includes('line-8'));
    await clickFullScreenComposer(session, 4, targetRow);
    await session.type('X');
    await session.waitForText('liXne-8');
    await exitInteractive(session);
  });

  it('returns from status when Ghostty sends protocol-encoded Escape', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
      cols: 120, rows: 40, env: { TERM_PROGRAM: 'ghostty' },
    });
    await session.waitForText('❯');
    await session.type('/status'); await session.press('enter');
    await session.waitForText('(tab to cycle)');
    session.writeRaw('\x1b[27u');
    await session.waitForText('Full screen', { timeout: 2_000 });
    await session.waitIdle();
    await session.type('after enhanced escape');
    await session.waitForText('❯ after enhanced escape');
    await expect.poll(() => composerCaretLine(session)).toBe('❯ after enhanced escape|');
    await exitInteractive(session);
  });

  it('preserves the about logo and returns from status to an editable composer', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 120, rows: 40,
    });
    await session.waitForText('❯');
    await session.type('/about'); await session.press('enter');
    await session.waitForText('docs.autohand.ai');
    const visibleRows = (text: string) => text.split('\n').map(line => line.trimEnd()).filter(line => line.trim()).join('\n');
    expect(visibleRows(outputViewport(session))).toContain(visibleRows(renderAutohandLogo({ columns: 120 })));
    await session.type('/status'); await session.press('enter');
    await session.waitForText('(tab to cycle)', { timeout: 15_000 });
    await session.press('tab'); await session.waitForText('Autohand preferences');
    await session.press('esc'); await session.waitForText('Full screen');
    await session.type('after status'); await session.waitForText('❯ after status');
    await expect.poll(() => composerCaretLine(session)).toBe('❯ after status|');
    await exitInteractive(session);
  }, 40_000);

  it('pages, searches, resizes and returns from usage without losing the composer or history', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true, cliUsageV2: true }, ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false } } });
    await seedFullScreenHistory(state.autohandHome, state.workspaceRoot);
    session = await launchBuiltAutohand(['resume', 'full-screen-history', '--config', state.configPath, '--offline'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 100, rows: 30 });
    await session.waitForText('History item 79', { timeout: 30_000 });
    const snapshot = await readFile(new URL('../../src/testing/snapshots/full-screen.txt', import.meta.url), 'utf8');
    for (const line of snapshot.trimEnd().split('\n')) expect(outputViewport(session)).toContain(line);
    await session.type('preserved draft'); await session.waitForText('❯ preserved draft');
    await session.write('\x1b[1;5H'); await session.waitForText('History item 0');
    await session.waitForText('Back to bottom');
    await session.press('esc'); await session.waitForText('History item 79');
    expect(outputViewport(session)).toContain('preserved draft');
    await session.press('pageup'); await session.waitForText('Ctrl+End latest');
    expect(outputViewport(session)).not.toContain('History item 79');
    await session.press(['ctrl', 'f']); await session.type('History item 20'); await session.press('enter');
    await session.waitForText('History item 20'); await session.press('esc');
    expect(outputViewport(session)).toContain('preserved draft');
    await session.resize({ cols: 60, rows: 20 }); await session.text();
    expect(outputViewport(session)).toContain('preserved draft');
    await expect.poll(() => outputViewport(session!)).toContain('History item 20');
    await session.write('\x1b[1;5F'); await session.waitForText('History item 79');
    for (let i = 0; i < 'preserved draft'.length; i++) await session.press('backspace');
    await session.type('/usage'); await session.press('enter'); await session.waitForText('Activity overview');
    await session.press('esc'); await session.waitForText('Full screen');
    expect(outputViewport(session)).toContain('History item 79');
    await session.type('draft after modal'); await session.waitForText('❯ draft after modal');
    await exitInteractive(session);
  }, 90_000);

  it('keeps the composer usable while working and paging through expanded output', async () => {
    server = await createMockAutohandAINativeSequenceServer([
      { content: 'Listing rows.', toolCall: { id: 'full-screen-output', name: 'run_command', args: LONG_OUTPUT_COMMAND } },
      { content: 'FULL_SCREEN_DONE' },
    ]);
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl },
      features: { fullScreenMode: true, autohand_inference: true },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--yes', '--config', state.configPath, '--path', state.workspaceRoot], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 80, rows: 24,
    });
    await runLongOutputTurn(session, 'FULL_SCREEN_DONE');
    expect(outputViewport(session)).toContain('❯');
    expect(outputViewport(session)).not.toContain('row-40');
    await session.press(['ctrl', 'o']); await session.waitForText('Ctrl+O collapse');
    expect(outputViewport(session)).toContain('row-1');
    await session.type('draft remains editable'); await session.waitForText('❯ draft remains editable');
    await session.press('pagedown'); await session.text();
    expect(outputViewport(session)).not.toContain('Ctrl+O collapse');
    expect(outputViewport(session)).toContain('draft remains editable');
    await session.write('\x1b[1;5F'); await session.waitForText('row-40');
    await session.press(['ctrl', 'o']); await session.waitForText('FULL_SCREEN_DONE');
    expect(outputViewport(session)).toContain('draft remains editable');
    expect(JSON.stringify(server.requests)).toContain('row-40');
    await exitInteractive(session);
  }, 90_000);

  it('retains formatted help in scrollable history after redraw', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 120, rows: 40,
    });
    await session.waitForText('❯');
    await session.type('/help'); await session.press('enter');
    await session.waitIdle();
    await session.type('help stays visible');
    await session.waitForText('❯ help stays visible');
    await session.waitForText('docs.autohand.ai');
    await session.write('\x1b[1;5H');
    await session.waitForText('/about');
    expect(outputViewport(session)).toContain('help stays visible');
    await exitInteractive(session);
  });

  it('marks command activity while reading history and returns to it without moving the draft', async () => {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    await seedFullScreenHistory(state.autohandHome, state.workspaceRoot);
    session = await launchBuiltAutohand(['resume', 'full-screen-history', '--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 120, rows: 40,
    });
    await session.waitForText('History item 79');
    await session.write('\x1b[1;5H'); await session.waitForText('History item 0');
    await session.type('/missing-full-screen-command'); await session.press('enter');
    await session.waitForText('New activity · ↓ Back to bottom');
    expect(outputViewport(session)).toContain('History item 0');
    await session.type('preserved draft');
    await session.waitForText('❯ preserved draft');
    const beforeRow = outputViewport(session).split('\n').findIndex(line => line.includes('❯ preserved draft'));
    await session.press('esc');
    await session.waitForText('Command /missing-full-screen-command is not supported.');
    expect(outputViewport(session)).not.toContain('New activity');
    expect(outputViewport(session).split('\n').findIndex(line => line.includes('❯ preserved draft'))).toBe(beforeRow);
    await expect.poll(() => composerCaretLine(session)).toBe('❯ preserved draft|');
    await exitInteractive(session);
  });

  it('defaults to full screen and persists opt-out across restarts', async () => {
    auth = await createMockAuthServer();
    const env = { AUTOHAND_API_URL: auth.baseUrl, AUTOHAND_AUTH_URL: auth.baseUrl, AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` };
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: undefined }, ui: { promptSuggestions: false } } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, env });
    await session.waitForText('❯');
    expect(outputViewport(session)).toContain('Full screen');
    await session.type('/experiments disable full_screen_mode'); await session.press('enter');
    await session.waitForText('Restart');
    const config = JSON.parse(await readFile(state.configPath, 'utf8'));
    expect(config.features.fullScreenMode).toBe(false);
    expect(outputViewport(session)).toContain('Full screen ·');
    await exitInteractive(session);
    session.close();
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env });
    await session.waitForText('❯');
    expect(outputViewport(session)).not.toContain('Full screen ·');
    expect(session.getRawOutput()).not.toContain('\x1b[?1049h');
    await session.type('inline opt-out works'); await session.waitForText('❯ inline opt-out works');
    await exitInteractive(session);
  });
});
