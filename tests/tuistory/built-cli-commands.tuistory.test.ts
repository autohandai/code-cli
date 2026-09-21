/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import fs from 'fs-extra';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import { hasTerminalProcessPid } from '../../src/testing/assertions/terminalOutput.js';
import { createStalledGoalStatePreload } from '../../src/testing/scenarios/goalsCommandScenario.js';
import {
  clearComposerInput,
  createMockChangelogFetchPreload,
  createMockMobilePairingFetchPreload,
  createMockOpenRouterServer,
  createMockOpenRouterFetchPreload,
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
} from './helpers/autohandTuistory.js';
import {
  CURSOR_CHAR,
  composerLineIncludes,
  createMockResearchEvidenceServer,
  expectStableSingleComposerFrames,
  launchInteractive,
  linesContaining,
  mockOpenRouterFetchPreloads,
  mockResearchEvidenceServers,
  mockServers,
  registerBuiltCliCleanup,
  sampleImmediateScreens,
  tempStates,
  trackSession,
  waitForComposer,
  waitForCursorAfterTypedText,
  waitForCursorPositionQuery,
  waitForTerminalCursorVisible,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

describe('interactive built CLI Tuistory tests: steering, caret, slash commands, and workspace output', () => {
  it('queues running-turn messages with Enter and steers a selected queued message on its next request', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'list_tree', args: { path: '.' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'STEERED_TURN_COMPLETE' }),
    ], 5_000);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    await waitForComposer(session);

    await session.type('List the workspace and summarize it.');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });
    // Steer only once the first request is in flight, so it lands on the second one.
    await vi.waitFor(() => expect(openRouterServer.requests.length).toBeGreaterThanOrEqual(1), { timeout: 20_000 });

    await session.type('STEER_ME: keep the summary to one line');
    await session.press('enter');
    const firstQueueScreen = await session.text({ timeout: 5_000, waitFor: (text) => /Queue · 1 pending/.test(text) });
    expect(firstQueueScreen).toContain('1. STEER_ME: keep the summary to one line');
    expect(firstQueueScreen).not.toContain('Steering the running turn; the model reads it on its next request.');
    await session.type('QUEUE_ME for after the turn');
    await session.press('enter');
    await session.text({ timeout: 5_000, waitFor: (text) => /Queue · 2 pending/.test(text) });
    await session.press('down');
    await session.press('enter');
    await session.text({ timeout: 5_000, waitFor: (text) => composerLineIncludes(text, 'STEER_ME: keep the summary to one line') });
    await session.press('enter');
    await session.text({ timeout: 5_000, waitFor: (text) => /Queue · 1 pending/.test(text) });

    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('STEERED_TURN_COMPLETE') });
    expect(openRouterServer.requests.length).toBeGreaterThanOrEqual(2);
    const secondRequest = openRouterServer.requests[1] as { messages: Array<{ role: string; content: unknown }> };
    const steered = secondRequest.messages.filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.includes('STEER_ME'));
    expect(steered).toHaveLength(1);
    const firstRequest = openRouterServer.requests[0] as { messages: Array<{ role: string; content: unknown }> };
    expect(JSON.stringify(firstRequest.messages)).not.toContain('STEER_ME');
    // The selected steer was consumed by the running turn; the other text remains queued.
    expect(JSON.stringify(secondRequest.messages)).not.toContain('QUEUE_ME');

    await exitInteractive(session);
  });

  it('shows the session name and state in the terminal title and restores it on exit', async () => {
    const openRouterServer = await createMockOpenRouterServer('TITLE_TURN_COMPLETE', 1_500);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    await waitForComposer(session);
    expect(session.getRawOutput()).toContain('\x1b]0;Autohand Code\x1b\\');

    await session.type('fix the caret after startup');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });
    // Derived name and the working marker appear as soon as the turn starts.
    expect(session.getRawOutput()).toMatch(/\x1b\]0;[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Fix the caret after startup · Autohand\x1b\\/u);

    await session.text({ timeout: 15_000, waitFor: (text) => text.includes('TITLE_TURN_COMPLETE') });
    await waitForComposer(session);
    await session.text({ timeout: 5_000, waitFor: () => session.getRawOutput().includes('\x1b]0;✓ Fix the caret after startup · Autohand\x1b\\') });

    await session.type('/rename Caret fix');
    await session.press('enter');
    await session.waitForText('Session renamed to "Caret fix".', { timeout: 10_000 });
    await session.text({ timeout: 5_000, waitFor: () => session.getRawOutput().includes('\x1b]0;✓ Caret fix · Autohand\x1b\\') });

    await exitInteractive(session);
    const raw = session.getRawOutput();
    expect(raw.lastIndexOf('\x1b]0;Autohand Code\x1b\\')).toBeGreaterThan(raw.lastIndexOf('✓ Caret fix'));
  });

  it('runs /init as a background repository read and keeps /init --basic instant', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: 'INIT_TURN_COMPLETE' }),
    ], 1_500);
    mockServers.push(openRouterServer);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));
    await waitForComposer(session);

    await session.type('/init');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('write AGENTS.md in the background') });
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('INIT_TURN_COMPLETE') });
    expect(openRouterServer.requests.length).toBeGreaterThanOrEqual(1);
    const request = openRouterServer.requests[0] as { messages: Array<{ role: string; content: unknown }> };
    const instruction = request.messages.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.includes('Create an AGENTS.md'));
    expect(instruction, JSON.stringify(request.messages).slice(0, 2_000)).toBeDefined();
    expect(String(instruction?.content)).toContain('"Definition of done"');
    expect(existsSync(path.join(state.workspaceRoot, 'AGENTS.md'))).toBe(false);

    await waitForComposer(session);
    // Background naming may still be in flight; only the basic init must stay model-free.
    await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
    const requestsBeforeBasic = openRouterServer.requests.length;
    await session.type('/init --basic');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Created AGENTS.md based on your project') });
    const agents = await readFile(path.join(state.workspaceRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('## Definition of Done');
    expect(openRouterServer.requests).toHaveLength(requestsBeforeBasic);

    await exitInteractive(session);
  });

  it('reports the startup timeline when AUTOHAND_STARTUP_TIMING is set', async () => {
    const session = await launchInteractive({
      config: { ui: { promptSuggestions: false } },
      env: { AUTOHAND_STARTUP_TIMING: '1' },
    });
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('Startup timing') });
    const screen = stripAnsi(await session.text({ immediate: true }));
    expect(screen).toContain('config loaded');
    expect(screen).toContain('agent constructed');
    expect(screen).toContain('composer ready');
    await waitForComposer(session);
    await exitInteractive(session);
  });

  it('keeps the @ $ and / dropdowns available while a turn is running', async () => {
    const openRouterServer = await createMockOpenRouterServer('DROPDOWNS_WHILE_WORKING_DONE', 6_000);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    await waitForComposer(session);
    await session.type('Take your time.');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });

    await session.type('$ex');
    expect(await session.text({ timeout: 5_000, waitFor: (text) => text.includes('$extension-builder') })).toContain('$extension-builder');
    await clearComposerInput(session);
    await session.type('@pack');
    expect(await session.text({ timeout: 5_000, waitFor: (text) => text.includes('@package.json') })).toContain('@package.json');
    await clearComposerInput(session);
    await session.type('/hel');
    expect(await session.text({ timeout: 5_000, waitFor: (text) => text.includes('/help') })).toContain('/help');
    await clearComposerInput(session);

    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('DROPDOWNS_WHILE_WORKING_DONE') });
    await exitInteractive(session);
  });

  it('suggests skills for a $ typed after other words in the composer', async () => {
    const session = await launchInteractive({ config: { ui: { promptSuggestions: false } } });
    await waitForComposer(session);
    // One write, as a paste or a burst of fast keystrokes arrives, typed
    // before the skills registry has necessarily finished loading.
    await session.type('hep me here $ex');
    const screen = await session.text({ timeout: 20_000, waitFor: (text) => text.includes('$extension-builder') });
    expect(screen).toContain('$extension-builder');
    expect(screen).toContain('Tab to accept');
    await exitInteractive(session);
  });

  it('keeps the caret and mouse reporting for text typed while startup is still finishing', async () => {
    const state = await createTempAutohandHome({
      config: {
        ui: {
          mouseComposerCursor: true,
          promptSuggestions: false,
        },
      },
    });
    tempStates.push(state);
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: await createStalledGoalStatePreload(state.workspaceRoot, state.autohandHome),
        },
        waitForDataTimeout: 15_000,
      })
    );

    // Ink mounts before startup has read the workspace goal state, so this
    // lands while startup is still finishing, exactly like a user who starts
    // typing the moment the composer appears.
    await waitForComposer(session);
    await session.type('hello');
    await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'hello'),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));

    // Startup is not a turn: nothing can be cancelled, so the composer must
    // never pass through a working state that treats the typed text as a
    // finished turn's draft and hides the caret until the next keystroke.
    const startupOutput = session.getRawOutput();
    expect(stripAnsi(startupOutput)).not.toContain('esc to cancel');
    expect(startupOutput).toContain('\x1b[?1000h\x1b[?1006h');
    expect(startupOutput).not.toContain('\x1b[?1006l\x1b[?1000l');
    await waitForCursorAfterTypedText(session, 'hello');

    await session.click('llo');
    await waitForCursorPositionQuery(session);

    await exitInteractive(session);
  });

  it('keeps only the real terminal cursor at the typed prompt position while composing', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);

    const prompt = 'ship the cursor';
    for (let index = 0; index < prompt.length; index += 1) {
      await session.type(prompt[index] ?? '');
      const typedPrefix = prompt.slice(0, index + 1);
      const visiblePrefix = typedPrefix.trimEnd();
      const screen = await session.text({
        timeout: 2_000,
        waitFor: (text) => composerLineIncludes(text, visiblePrefix),
        trimEnd: true,
      });

      expect(screen).toContain(visiblePrefix);
      expect(screen).not.toContain(CURSOR_CHAR);

      const cursorScreen = await waitForCursorAfterTypedText(session, typedPrefix);
      expect(linesContaining(cursorScreen, CURSOR_CHAR)).toHaveLength(1);
    }

    await exitInteractive(session);
  });

  it('keeps cursor editing natural when inserting in the middle of composer text', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('hello');
    await session.press('left');
    await session.press('left');
    await session.type('X');

    const screen = await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'helXlo'),
      trimEnd: true,
    });

    expect(screen).toContain('helXlo');
    expect(screen).not.toContain('helloX');

    await exitInteractive(session);
  });

  it('positions the real composer cursor with a mouse click', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          mouseComposerCursor: true,
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('hello');
    const cursorScreen = await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'hello'),
      trimEnd: true,
    });

    expect(session.getRawOutput()).toContain('\x1b[?1000h\x1b[?1006h');
    expect(composerLineIncludes(cursorScreen, 'hello')).toBe(true);

    await session.click('llo');
    await waitForCursorPositionQuery(session);
    const [terminalCursorColumn, terminalCursorRow] = session.getTerminalData().cursor;
    session.writeRaw(`\x1b[${terminalCursorRow + 1};${terminalCursorColumn + 1}R`);
    await session.waitIdle();
    await waitForTerminalCursorVisible(session);
    await session.type('X');

    const screen = await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'heXllo'),
      trimEnd: true,
    });

    expect(screen).toContain('heXllo');
    expect(screen).not.toContain('helloX');

    await exitInteractive(session);
    expect(session.getRawOutput()).toContain('\x1b[?1006l\x1b[?1000l');
  });

  it('does not let a stale composer click hijack the caret after the DSR reply is lost', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          mouseComposerCursor: true,
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('hello');
    await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'hello'),
      trimEnd: true,
    });

    // Click, but the terminal never answers the DSR query (e.g. tmux without
    // passthrough). The user keeps typing instead.
    await session.click('llo');
    await waitForCursorPositionQuery(session);
    await session.type('Y');
    await session.waitIdle();

    // A late CPR-shaped report must not reposition the caret.
    const [terminalCursorColumn, terminalCursorRow] = session.getTerminalData().cursor;
    session.writeRaw(`\x1b[${terminalCursorRow + 1};${terminalCursorColumn + 1}R`);
    await session.waitIdle();
    await session.type('X');

    const screen = await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'helloYX'),
      trimEnd: true,
    });

    expect(screen).toContain('helloYX');

    await exitInteractive(session);
  });

  it('keeps multiline, large paste, and image paste placeholders intact in the real prompt', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    // Shift+Enter is only distinguishable from Enter once the terminal encodes
    // modified keys; the composer asks for the kitty disambiguate flag on start.
    expect(session.getRawOutput()).toContain('\u001b[>1u');
    await session.type('first line');
    await session.press(['shift', 'enter']);
    await session.type('second line');

    const multilineScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('first line') && text.includes('second line'),
      trimEnd: true,
    });

    expect(multilineScreen).toContain('first line');
    expect(multilineScreen).toContain('second line');

    await clearComposerInput(session);

    const pastedText = Array.from({ length: 101 }, (_, index) => `pasted line ${index + 1}`)
      .join('\n');
    session.writeRaw(`\u001b[200~${pastedText}\u001b[201~`);

    const largePasteScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('[Text Pasted +101 lines]'),
      trimEnd: true,
    });

    expect(largePasteScreen).toContain('[Text Pasted +101 lines]');
    expect(largePasteScreen).not.toContain('pasted line 101');

    await clearComposerInput(session);

    session.writeRaw(
      '\u001b[200~data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=\u001b[201~'
    );

    const imagePasteScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => /\[Image #\d+\]/.test(text),
      trimEnd: true,
    });

    expect(imagePasteScreen).toMatch(/\[Image #\d+\]/);

    await exitInteractive(session);
    const rawOutput = session.getRawOutput();
    expect(rawOutput.lastIndexOf('\u001b[<u')).toBeGreaterThan(rawOutput.indexOf('\u001b[>1u'));
  });

  it('auto-initializes git for an empty workspace before rendering the composer', async () => {
    const state = await createTempAutohandHome({
      initializeGit: false,
      writePackageJson: false,
    });
    tempStates.push(state);
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);

    expect(await fs.pathExists(path.join(state.workspaceRoot, '.git'))).toBe(true);

    await exitInteractive(session);
  });

  it('shows slash command suggestions for a bare slash', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    await session.type('/');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('Tab to accept') && text.includes('/about'),
    });
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('/about');
    expect(screen).toContain('/add-dir');
    expect(screen).toContain('Tab to accept');
    const lines = screen.split('\n');
    const composerRow = lines.findIndex((line) => line.includes('❯ /'));
    const statusRow = lines.findIndex((line) => line.includes('context left'));
    const dropdownRow = lines.findIndex((line) => line.includes('show information about Autohand'));
    expect(composerRow, screen).toBeGreaterThan(-1);
    expect(statusRow, screen).toBeGreaterThan(composerRow);
    expect(dropdownRow, screen).toBeGreaterThan(statusRow);

    await exitInteractive(session);
  });

  it('shows /changelog output and restores the composer', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const changelogPreload = await createMockChangelogFetchPreload();
    mockOpenRouterFetchPreloads.push(changelogPreload);
    const session = await trackSession(launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${changelogPreload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
      waitForDataTimeout: 15_000,
    }));

    await waitForComposer(session);
    await session.type('/changelog');
    await session.press('enter');
    const screen = await session.text({
      timeout: 10_000,
      waitFor: (text) => (
        text.includes('Autohand Changelog')
        && text.includes('v9.8.7 — Tuistory release')
        && text.includes('Visible changelog output')
        && text.includes('❯')
      ),
      trimEnd: true,
    });

    expect(screen).toContain('Published Jul 27, 2026');
    expect(screen).toContain('github.com/autohandai/code-cli/releases/tag/v9.8.7');
    await exitInteractive(session);
  });

  it('renders a scan-grade, high-contrast QR code with a full quiet zone for /go', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const pairingPreload = await createMockMobilePairingFetchPreload();
    mockOpenRouterFetchPreloads.push(pairingPreload);
    const session = await trackSession(launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        AUTOHAND_API_URL: 'https://api.tuistory.test',
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${pairingPreload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
      cols: 120,
      rows: 60,
      waitForDataTimeout: 15_000,
    }));

    await waitForComposer(session);
    await session.type('/go --queue');
    await session.press('enter');
    const screen = stripAnsi(await session.text({
      timeout: 15_000,
      waitFor: (text) => (
        text.includes('Autohand Code mobile handoff')
        && text.includes('Scan or open:')
        && text.includes('Mode: queue')
        && text.includes('❯')
      ),
      trimEnd: true,
    }));
    const lines = screen.split('\n');
    const instructionsIndex = lines.findIndex((line) => line.includes('Scan this with the iOS app'));
    const linkIndex = lines.findIndex((line) => line.includes('Scan or open:'));
    const qrLines = lines
      .slice(instructionsIndex + 1, linkIndex)
      .filter((line) => /[▀▄█]/u.test(line));

    expect(instructionsIndex, screen).toBeGreaterThanOrEqual(0);
    expect(linkIndex, screen).toBeGreaterThan(instructionsIndex);
    expect(qrLines.length, screen).toBeGreaterThanOrEqual(25);
    expect(qrLines.length, screen).toBeLessThanOrEqual(32);
    expect(Math.max(...qrLines.map((line) => line.length)), screen).toBeGreaterThanOrEqual(52);
    expect(Math.max(...qrLines.map((line) => line.length)), screen).toBeLessThanOrEqual(60);
    // Tuistory trims trailing screen whitespace, so the renderer option test
    // covers the right margin while this proves the visible left quiet zone.
    expect(qrLines.every((line) => line.startsWith('    ')), screen).toBe(true);
    expect(session.getRawOutput()).toMatch(
      /\u001B\[(?:30m\u001B\[47m|47m\u001B\[30m)/u
    );

    await exitInteractive(session);
  }, 60_000);

  it('uses /browser and keeps /chrome as a hidden compatibility alias', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    await session.type('/bro');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('/browser') && text.includes('Tab to accept'),
    });
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('/browser');
    expect(screen).not.toContain('/chrome');

    await clearComposerInput(session);
    await session.type('/chr');
    const hiddenAliasScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => composerLineIncludes(text, '/chr') && !text.includes('Tab to accept'),
      trimEnd: true,
    });
    expect(hiddenAliasScreen).not.toContain('/chrome');

    await clearComposerInput(session);
    await session.type('/browser disconnect');
    await session.press('enter');
    await session.waitForText('Browser bridge disconnected and disabled.', { timeout: 10_000 });

    await waitForComposer(session);
    await session.type('/chrome disconnect');
    await session.press('enter');
    await session.waitForText('The /chrome command is retained only for compatibility. Use /browser instead.', { timeout: 10_000 });
    await session.waitForText('Browser bridge disconnected and disabled.', { timeout: 10_000 });

    await exitInteractive(session);
  });

  it('runs the slash help command from the interactive TUI', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    await session.type('/help');
    await session.press('enter');
    await session.waitForText(/Available|commands/i, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('/help');
    expect(output).toMatch(/Available|commands/i);

    await exitInteractive(session);
  });

  it('inspects project memory through the hierarchical slash command flow', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const memoryDir = path.join(state.workspaceRoot, '.autohand', 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, 'legacy-memory.json'),
      JSON.stringify({
        id: 'legacy-memory',
        content: 'Use strict TypeScript for project code.',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
        tags: ['typescript'],
      }),
    );
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      }),
    );

    await waitForComposer(session);
    await session.type('/memory outline project');
    await session.press('enter');
    await session.waitForText('Memory outline (project)', { timeout: 10_000 });
    await session.waitForText('snapshot=', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Use strict TypeScript for project code.');
    expect(output).toContain('/memory zoom project');

    await exitInteractive(session);
  });

  it('persists slash-command usage without arguments in the project memory ledger', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      }),
    );

    await waitForComposer(session);
    await session.type('/about private-argument');
    await session.press('enter');
    await session.waitForText('Autohand', { timeout: 10_000 });
    await exitInteractive(session);

    const log = await readFile(
      path.join(state.workspaceRoot, '.autohand', 'memory', 'events', 'LOG.jsonl'),
      'utf8',
    );
    const event = log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((candidate) => (
        candidate.operation === 'capability_used'
        && (candidate.capability as { name?: string } | undefined)?.name === '/about'
      ));

    expect(event).toMatchObject({
      operation: 'capability_used',
      level: 'project',
      capability: {
        kind: 'slash_command',
        name: '/about',
        source: 'core',
      },
      origin: 'user',
      outcome: 'succeeded',
    });
    expect(event).not.toHaveProperty('args');
    expect(log).not.toContain('private-argument');
  });

  it('keeps a saved research report local when the publish prompt uses its default choice', async () => {
    const reportPath = '.autohand/research/publish-candidate.md';
    const state = await createTempAutohandHome({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });
    tempStates.push(state);
    await mkdir(path.dirname(path.join(state.workspaceRoot, reportPath)), { recursive: true });
    await writeFile(
      path.join(state.workspaceRoot, reportPath),
      '# Publish candidate\n\nA saved report that must remain local unless the operator consents.\n',
    );

    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_NON_INTERACTIVE: undefined,
          CI: undefined,
        },
        waitForDataTimeout: 15_000,
      }),
    );

    await waitForComposer(session);
    await session.type(`/publish-research ${reportPath}`);
    await session.press('enter');
    await session.waitForText('Would you like to publish this research?', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText(
      `Publication cancelled. Research remains local at ${reportPath}.`,
      { timeout: 10_000 },
    );

    expect(existsSync(path.join(state.workspaceRoot, reportPath))).toBe(true);
    expect(existsSync(path.join(state.workspaceRoot, `${reportPath}.publication.json`))).toBe(false);
    expect(session.readAll()).not.toContain('Open Research needs a valid Autohand login');

    await exitInteractive(session);
  });

  it('keeps only one live composer and help block after an interactive command returns', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/help');
    await session.press('enter');
    await session.waitForText(/Available|commands/i, { timeout: 10_000 });

    const screen = await session.text({
      timeout: 10_000,
      waitFor: (text) => (
        text.includes('❯') &&
        text.includes('Autohand (') &&
        !text.includes('Wandering')
      ),
      trimEnd: true,
    });

    expect(linesContaining(screen, '❯'), screen).toHaveLength(1);
    expect(linesContaining(screen, 'Autohand ('), screen).toHaveLength(1);
    expect(screen).not.toContain('Wandering');

    await exitInteractive(session);
  });

  it('keeps only one live composer and help block after an agent turn returns', async () => {
    const openRouterFetchPreload = await createMockOpenRouterFetchPreload(
      'Here is the mocked final answer from Tuistory.',
      1_300,
    );
    mockOpenRouterFetchPreloads.push(openRouterFetchPreload);
    const session = await launchInteractive({
      config: {
        openrouter: {
          baseUrl: 'https://mock.openrouter.test/api/v1',
        },
      },
      env: {
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${openRouterFetchPreload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
    });

    await waitForComposer(session);
    await session.type('give me the mocked answer');
    await session.press('enter');
    await session.waitForText('...', { timeout: 5_000 });
    expectStableSingleComposerFrames(await sampleImmediateScreens(session, 500));

    await session.waitForText('Here is the mocked final answer from Tuistory.', { timeout: 15_000 });
    expectStableSingleComposerFrames(await sampleImmediateScreens(session, 2_000));

    const screen = await session.text({
      timeout: 10_000,
      waitFor: (text) => (
        text.includes('❯') &&
        text.includes('Here is the mocked final answer from Tuistory.') &&
        !text.includes('Wandering')
      ),
      trimEnd: true,
    });

    expect(linesContaining(screen, '❯'), screen).toHaveLength(1);
    expect(screen).not.toContain('Wandering');

    await session.type('Review the current git diff');
    await waitForCursorAfterTypedText(session, 'Review the current git diff');

    await exitInteractive(session);
  }, 60_000);

  it('runs /deep-research for Hermes self evolving and DSPy with mocked evidence and saves the report', async () => {
    const evidenceServer = await createMockResearchEvidenceServer();
    mockResearchEvidenceServers.push(evidenceServer);

    const reportPath = '.autohand/research/topic-hermes-self-evolving-and-dspy.md';
    const report = [
      '# Hermes self evolving and DSPy',
      '',
      '## Summary',
      'Hermes self-evolving work uses iterative critique loops; DSPy provides declarative modules and optimizers.',
      '',
      '## Findings',
      '- Hermes self evolving: mocked fetch evidence shows iterative improvement loops [1].',
      '- DSPy: mocked fetch evidence shows declarative language model programs [2].',
      '',
      '## Open questions',
      '- This Tuistory fixture uses mocked sources only.',
      '',
      '## Sources',
      `1. Hermes fixture - fetched from ${evidenceServer.baseUrl}/hermes`,
      `2. DSPy fixture - fetched from ${evidenceServer.baseUrl}/dspy`,
      '',
    ].join('\n');
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Gather mocked fetch_url evidence and save the reusable research report.',
        toolCalls: [
          {
            tool: 'todo_write',
            args: {
              tasks: [
                { title: 'Scope the research question', status: 'completed' },
                { title: 'Gather and cross-check evidence', status: 'completed' },
                { title: 'Write the cited report', status: 'completed' },
              ],
            },
          },
          { tool: 'fetch_url', args: { url: `${evidenceServer.baseUrl}/hermes`, max_length: 2000 } },
          { tool: 'fetch_url', args: { url: `${evidenceServer.baseUrl}/dspy`, max_length: 2000 } },
          { tool: 'write_file', args: { path: reportPath, contents: report } },
        ],
      }),
      JSON.stringify({
        reflection: 'The mocked fetch_url results and write_file output show the research report was saved.',
        toolCalls: [],
        finalResponse: `Research saved: ${reportPath}\n\nHermes self evolving and DSPy research is ready for the next prompt.`,
      }),
    ]);
    mockServers.push(openRouterServer);

    const state = await createTempAutohandHome({
      config: {
        openrouter: {
          baseUrl: openRouterServer.baseUrl,
        },
        ui: {
          promptSuggestions: false,
        },
        agent: {
          maxIterations: 4,
        },
        features: {
          automaticSpecialists: false,
        },
      },
    });
    tempStates.push(state);

    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);
    await session.type('/deep-research Hermes self evolving and DSPy');
    await session.press('enter');
    await session.waitForText('Deep research started', { timeout: 10_000 });
    // /deep-research switches the session into automode, so tool calls are
    // auto-approved and the post-turn publish step skips its blocking
    // confirmation in favor of an informational recovery hint instead.
    await session.waitForText(
      'Skipping the interactive publish prompt while auto mode is active.',
      { timeout: 30_000 },
    );
    await session.waitForText(
      `Publish later with: /publish-research ${reportPath}`,
      { timeout: 10_000 },
    );

    const output = session.readAll();
    expect(output).toContain(`Research saved: ${reportPath}`);
    expect(output).not.toContain('Allow tool write_file?');
    expect(output).not.toContain('Write to this file?');
    expect(output).not.toContain(`Create new file ${reportPath}?`);
    expect(output).not.toContain('Would you like to publish this research?');

    const savedReportPath = path.join(state.workspaceRoot, reportPath);
    expect(existsSync(savedReportPath)).toBe(true);
    const savedReport = await readFile(savedReportPath, 'utf8');
    expect(savedReport).toContain('Hermes self-evolving');
    expect(savedReport).toContain('DSPy');

    await session.type('Use the previous deep research');
    await waitForCursorAfterTypedText(session, 'Use the previous deep research');

    await exitInteractive(session);
  }, 90_000);

  it('renders files created by shell tools through the workspace change view', async () => {
    const outputPath = 'shell-created.txt';
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Create the requested file through the shell tool.',
        toolCalls: [{
          tool: 'shell',
          args: {
            command: `printf 'created by shell\\n' > ${outputPath}`,
          },
        }],
      }),
      JSON.stringify({
        reflection: 'The shell command created the requested file.',
        toolCalls: [],
        finalResponse: `Created ${outputPath}.`,
      }),
    ]);
    mockServers.push(openRouterServer);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        ui: { promptSuggestions: false },
        agent: { maxIterations: 3 },
      },
    });
    tempStates.push(state);

    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);
    await session.type('Create a file using the shell tool');
    await session.press('enter');
    const permissionOrAdded = await session.text({
      timeout: 60_000,
      waitFor: (text) => (
        text.includes('Allow the agent to run a shell command with live output?')
        || text.includes(`Added ${outputPath}`)
      ),
    });
    if (permissionOrAdded.includes('Allow the agent to run a shell command with live output?')) {
      await session.press('enter');
    }
    await session.waitForText(`Added ${outputPath}`, { timeout: 60_000 });
    await session.waitForText(`Created ${outputPath}.`, { timeout: 60_000 });

    expect(await readFile(path.join(state.workspaceRoot, outputPath), 'utf8')).toBe('created by shell\n');
    await exitInteractive(session);
  }, 90_000);

  it('groups parallel read_file calls into a single batched render', async () => {
    const files = ['alpha.txt', 'beta.txt', 'gamma.txt', 'delta.txt'];
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Read all four notes together.',
        toolCalls: files.map((file) => ({ tool: 'read_file', args: { path: file } })),
      }),
      JSON.stringify({
        reflection: 'All four notes were read.',
        toolCalls: [],
        finalResponse: 'All four notes are read.',
      }),
    ]);
    mockServers.push(openRouterServer);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        ui: { promptSuggestions: false },
        agent: { maxIterations: 3 },
      },
    });
    tempStates.push(state);
    for (const [index, file] of files.entries()) {
      await writeFile(path.join(state.workspaceRoot, file), `note ${index}\nbody ${index}\nend ${index}\n`);
    }

    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);
    await session.type('Read all four notes');
    await session.press('enter');
    await session.waitForText('All four notes are read.', { timeout: 60_000 });

    const output = session.readAll();
    expect(output).toContain('✔ read_file (4)');
    expect(output.match(/✔ read_file/g) ?? []).toHaveLength(1);
    expect(output).toContain('alpha.txt, beta.txt (+2 more)');
    for (const file of files) {
      expect(output).toMatch(new RegExp(`[├└] ${file} —`));
    }
    expect(output.match(/└ (?:alpha|beta|gamma|delta)\.txt —/g) ?? []).toHaveLength(1);
    await exitInteractive(session);
  }, 90_000);

  it('streams compact background shell output and expands it with a mouse click', async () => {
    const backgroundScript = [
      'let line = 1',
      'const parentPid = process.ppid',
      'setInterval(() => { try { process.kill(parentPid, 0); } catch { process.exit(0); } }, 250)',
      "const timer = setInterval(() => { console.log('background-line-' + String(line).padStart(2, '0')); line += 1; if (line > 16) { clearInterval(timer); setTimeout(() => process.exit(0), 60000); } }, 25)",
    ].join(';');
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Run the requested task in the background.',
        toolCalls: [{
          tool: 'shell',
          args: {
            command: `${process.execPath} -e ${JSON.stringify(backgroundScript)}`,
            background: true,
          },
        }],
      }),
      JSON.stringify({
        reflection: 'The background task started and can continue independently.',
        toolCalls: [],
        finalResponse: 'Background task started.',
      }),
    ]);
    mockServers.push(openRouterServer);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        ui: { mouseComposerCursor: true, promptSuggestions: false },
        agent: { maxIterations: 3 },
      },
    });
    tempStates.push(state);

    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);
    await session.type('Start a background shell task and keep its output visible');
    await session.press('enter');
    const permissionOrRunning = await session.text({
      timeout: 30_000,
      waitFor: (text) => (
        text.includes('Allow the agent to run a shell command with live output?')
        || text.includes('Ctrl+O expand')
      ),
    });
    if (permissionOrRunning.includes('Allow the agent to run a shell command with live output?')) {
      await session.press('enter');
    }

    await session.waitForText('background-line-16', { timeout: 10_000 });
    await session.waitForText('Ctrl+O expand', { timeout: 10_000 });
    expect(session.readAll()).not.toContain('background-line-01');

    await session.click('background-line-16');
    await waitForCursorPositionQuery(session);
    const [terminalCursorColumn, terminalCursorRow] = session.getTerminalData().cursor;
    session.writeRaw(`\x1b[${terminalCursorRow + 1};${terminalCursorColumn + 1}R`);
    await session.waitForText('Ctrl+O collapse', { timeout: 5_000 });
    await session.waitForText('background-line-01', { timeout: 5_000 });
    await session.waitForText('Background task started.', { timeout: 30_000 });

    await exitInteractive(session);
  }, 90_000);

  it('lists and stops a background shell process with /ps and /stop', async () => {
    const backgroundScript = [
      'let line = 1',
      'const parentPid = process.ppid',
      'setInterval(() => { try { process.kill(parentPid, 0); } catch { process.exit(0); } }, 250)',
      "setInterval(() => { console.log('tick-' + line); line += 1; }, 100)",
    ].join(';');
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Run the requested long-lived task in the background.',
        toolCalls: [{
          tool: 'shell',
          args: {
            command: `${process.execPath} -e ${JSON.stringify(backgroundScript)}`,
            background: true,
          },
        }],
      }),
      JSON.stringify({
        reflection: 'The background task started and can continue independently.',
        toolCalls: [],
        finalResponse: 'Background task started.',
      }),
    ]);
    mockServers.push(openRouterServer);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        ui: { promptSuggestions: false },
        agent: { maxIterations: 3 },
      },
    });
    tempStates.push(state);

    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);
    await session.type('Start a long-lived background task and keep it running');
    await session.press('enter');
    const permissionOrStarted = await session.text({
      timeout: 30_000,
      waitFor: (text) => (
        text.includes('Allow the agent to run a shell command with live output?')
        || text.includes('Background task started.')
      ),
    });
    if (permissionOrStarted.includes('Allow the agent to run a shell command with live output?')) {
      await session.press('enter');
    }
    await session.waitForText('Background task started.', { timeout: 30_000 });

    const startedOutput = session.readAll();
    const pidMatch = startedOutput.match(/Background PID: (\d+)/);
    expect(pidMatch, startedOutput).toBeTruthy();
    const pid = Number(pidMatch![1]);

    // This test only checks that /ps lists the process and /stop kills it; it
    // makes no claim about latency, so the waits are sized for a loaded runner
    // rather than for timing.
    await waitForComposer(session);
    await session.type('/ps');
    await session.press('enter');
    await session.text({
      timeout: 30_000,
      waitFor: (text) => hasTerminalProcessPid(text, pid),
    });
    const psOutput = session.readAll();
    expect(hasTerminalProcessPid(psOutput, pid), psOutput).toBe(true);
    expect(psOutput).toMatch(/^1\s{2}/m);

    await waitForComposer(session);
    await session.type('/stop 1');
    await session.press('enter');
    await session.waitForText('Stopped', { timeout: 30_000 });
    const stopOutput = session.readAll();
    expect(hasTerminalProcessPid(stopOutput, pid), stopOutput).toBe(true);

    const exitDeadline = Date.now() + 5_000;
    let processExited = false;
    while (Date.now() < exitDeadline) {
      try {
        process.kill(pid, 0);
      } catch {
        processExited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(processExited, `expected pid ${pid} to have exited after /stop`).toBe(true);

    await waitForComposer(session);
    await session.type('/ps');
    await session.press('enter');
    await session.waitForText('No background processes running.', { timeout: 10_000 });

    await exitInteractive(session);
  }, 60_000);
});
