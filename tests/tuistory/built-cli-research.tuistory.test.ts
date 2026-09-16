/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import stripAnsi from 'strip-ansi';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import { hasTerminalProcessPid } from '../../src/testing/assertions/terminalOutput.js';
import { selectTheme, selectThemeFromSettings } from '../../src/testing/scenarios/themeScenario.js';
import { getHelpOrderedSlashCommands } from '../../src/ui/inputPrompt.js';
import {
  clearComposerInput,
  createMockAuthServer,
  createMockOllamaServer,
  createMockOpenRouterFetchPreload,
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  dismissAutocompleteMenu,
  exitInteractive,
  launchBuiltAutohand,
} from './helpers/autohandTuistory.js';
import {
  MODAL_OPTION_ROW,
  isModalNumericShortcut,
  launchInteractive,
  mockAuthServers,
  mockOpenRouterFetchPreloads,
  mockServers,
  registerBuiltCliCleanup,
  selectModalOptionByLabel,
  tempStates,
  trackSession,
  typeLikeUser,
  waitForComposer,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

describe('interactive built CLI Tuistory tests: processes, research, usage, settings, and providers', () => {
  it('runs /ps and /stop immediately while a slow foreground command is still active', async () => {
    const backgroundScript = [
      'let line = 1',
      'const parentPid = process.ppid',
      'setInterval(() => { try { process.kill(parentPid, 0); } catch { process.exit(0); } }, 250)',
      "setInterval(() => { console.log('tick-' + line); line += 1; }, 100)",
    ].join(';');
    const slowForegroundScript = 'setTimeout(() => process.exit(0), 4000)';
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Start the background task, then run a slow foreground command.',
        toolCalls: [
          {
            tool: 'shell',
            args: {
              command: `${process.execPath} -e ${JSON.stringify(backgroundScript)}`,
              background: true,
            },
          },
          {
            tool: 'run_command',
            args: {
              command: `${process.execPath} -e ${JSON.stringify(slowForegroundScript)}`,
            },
          },
        ],
      }),
      JSON.stringify({
        reflection: 'The background task started and the slow foreground command finished.',
        toolCalls: [],
        finalResponse: 'Background task started and slow command finished.',
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
    await session.type('Start a background task, then run a slow foreground command');
    await session.press('enter');

    // The background tool call resolves almost instantly; the slow
    // foreground command (4s) keeps the turn active while we test /ps
    // and /stop below.
    await session.waitForText('Background PID:', { timeout: 15_000 });
    const startedOutput = session.readAll();
    const pidMatch = startedOutput.match(/Background PID: (\d+)/);
    expect(pidMatch, startedOutput).toBeTruthy();
    const pid = Number(pidMatch![1]);
    expect(startedOutput).not.toContain('Background task started and slow command finished.');

    // The slow foreground command is still running (turn still active). The
    // assertion after each wait is what proves /ps and /stop were not queued:
    // a queued command could only render after the slow command finished, at
    // which point the completion marker would already be on screen. Ordering
    // carries the proof, so the wait itself is generous — a tight clock only
    // made this fail on loaded CI runners without testing anything extra.
    await session.type('/ps');
    await session.press('enter');
    await session.text({
      timeout: 30_000,
      waitFor: (text) => hasTerminalProcessPid(text, pid),
    });
    expect(session.readAll()).not.toContain('Background task started and slow command finished.');

    await session.type('/stop 1');
    await session.press('enter');
    await session.waitForText('Stopped', { timeout: 30_000 });
    expect(session.readAll()).not.toContain('Background task started and slow command finished.');

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

    // The original turn continues and eventually completes normally.
    await session.waitForText('Background task started and slow command finished.', { timeout: 15_000 });

    await waitForComposer(session);
    await session.type('/ps');
    await session.press('enter');
    await session.waitForText('No background processes running.', { timeout: 10_000 });

    await exitInteractive(session);
  }, 60_000);

  it('keeps premature deep research incomplete and exposes the blockers through status', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'There is still substantial evidence to gather.',
        toolCalls: [],
        finalResponse: 'Completed the research.',
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
          maxIterations: 2,
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
    await session.type('/deep-search premature completion audit');
    await session.press('enter');
    await session.waitForText('Deep research started', { timeout: 10_000 });
    await session.waitForText('Deep research incomplete', { timeout: 45_000 });

    await session.type('/deep-search status');
    await session.press('enter');
    await session.waitForText('State: Incomplete', { timeout: 10_000 });
    const status = session.readAll();

    expect(status).toContain('The report has not been written.');
    expect(status).toContain('No research task plan was recorded.');
    expect(status).not.toContain('Completed in');

    await exitInteractive(session);
  }, 90_000);

  it('shows deep research status while the model turn is still active', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'The delayed response should arrive after the live status check.',
        toolCalls: [],
        finalResponse: 'Research is still incomplete.',
      }),
    ], 5_000);
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
          maxIterations: 2,
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
    await session.type('/deep-research live progress audit');
    await session.press('enter');
    await session.waitForText('Deep research started', { timeout: 10_000 });

    await session.type('/deep-research status');
    await session.press('enter');
    await session.waitForText('State: Running', { timeout: 3_000 });
    const activeStatus = session.readAll();

    expect(activeStatus).toContain('Progress: No task plan recorded yet.');
    expect(activeStatus).toContain('Report: .autohand/research/topic-live-progress-audit.md (not written yet)');
    expect(activeStatus).not.toContain('Research is still incomplete.');

    await session.waitForText('Deep research incomplete', { timeout: 30_000 });
    await exitInteractive(session);
  }, 90_000);

  it('runs the usage activity dashboard from the interactive TUI', async () => {
    const session = await launchInteractive({
      config: {
        provider: 'openai',
        openai: {
          apiKey: 'tuistory-test-api-key',
          model: 'gpt-5.5',
          contextWindow: 258000,
          reasoningEffort: 'high',
        },
        features: {
          cliUsageV2: true,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/usage');
    await session.press('enter');
    await session.waitForText('Token activity', { timeout: 10_000 });
    const output = session.readAll();
    const screen = stripAnsi(await session.text({ immediate: true, trimEnd: true }));
    const screenLines = screen.split('\n');
    const sundayIndex = screenLines.findIndex((line) => line.startsWith('Su  '));
    const monthHeader = sundayIndex > 0
      ? screenLines.slice(0, sundayIndex).reverse().find((line) => line.trim().length > 0) ?? ''
      : '';
    const visibleMonthLabels = monthHeader.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/gu) ?? [];

    expect(output).toContain('/usage daily');
    expect(output).toContain('last 12 months');
    expect(output).toContain('Lifetime');
    expect(output).toContain('Peak');
    expect(output).toContain('Streak');
    expect(output).toContain('Longest task');
    expect(output).toContain('Less');
    expect(output).toContain('More');
    expect(output).toContain('daily · weekly · monthly');
    expect(output).not.toContain('Provider limits:');
    expect(sundayIndex, screen).toBeGreaterThan(0);
    expect(visibleMonthLabels.length, screen).toBeGreaterThanOrEqual(12);

    await exitInteractive(session);
    const finalScreen = stripAnsi(await session.text({ immediate: true, trimEnd: true }));
    const teardownLines = finalScreen
      .split('\n')
      .filter((line) => line.includes('Ending Autohand session') || line.includes('Session saved'));

    expect(teardownLines.some((line) => line.includes('Ending Autohand session')), finalScreen).toBe(true);
    expect(teardownLines.some((line) => line.includes('Session saved')), finalScreen).toBe(true);
    expect(teardownLines.every((line) => !/[·░▒▓█]/u.test(line)), finalScreen).toBe(true);
  });

  it('shows the signed-in Autohand plan and quota in /usage', async () => {
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const session = await launchInteractive({
      config: {
        provider: 'openai',
        openai: {
          apiKey: 'tuistory-test-api-key',
          model: 'gpt-5.5',
        },
        auth: {
          token: 'tuistory-account-token',
          user: {
            id: 'tuistory-test-user',
            email: 'tuistory@example.com',
            name: 'Tuistory Test',
          },
        },
        features: { cliUsageV2: true },
      },
      env: {
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
      },
    });

    await waitForComposer(session);
    await session.type('/usage');
    await session.press('enter');
    await session.waitForText('Autohand Code Pro', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Autohand plan');
    expect(output).toContain('250 requests / 5 hours');
    expect(output).toContain('1K requests / 24 hours');
    expect(output).toContain('7K requests / week');
    expect(output).toContain('1K requests / minute');
    expect(output).toContain('500K uncached input tokens / minute');
    expect(output).toContain('80K output tokens / minute');
    await exitInteractive(session);
  });

  it('corrects a model the Autohand cloud gateway does not serve back to fantail', async () => {
    // Issue #584: a model left over from another provider stayed selected under
    // the autohandai provider and was shown (and sent) as the session model.
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const session = await launchInteractive({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'account',
          accountToken: 'tuistory-account-token',
          model: 'anthropic/claude-5-sonnet',
        },
        auth: {
          token: 'tuistory-account-token',
          user: {
            id: 'tuistory-test-user',
            email: 'tuistory@example.com',
            name: 'Tuistory Test',
          },
        },
      },
      env: {
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
      },
    });

    await waitForComposer(session);
    await session.waitForText('(Autohand AI, fantail)', { timeout: 10_000 });
    expect(session.readAll()).not.toContain('claude-5-sonnet');

    await exitInteractive(session);
  });

  it('shows the signed-in Autohand plan and live provider quota in the /status Usage tab', async () => {
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const session = await launchInteractive({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'account',
          accountToken: 'tuistory-account-token',
          model: 'moa',
          reasoningEffort: 'xhigh',
          contextWindow: 1_000_000,
        },
        auth: {
          token: 'tuistory-account-token',
          user: {
            id: 'tuistory-test-user',
            email: 'tuistory@example.com',
            name: 'Tuistory Test',
          },
        },
        features: { usageV2: true, cliUsageV2: false },
      },
      env: {
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
      },
    });

    await waitForComposer(session);
    await session.waitForText('Autohand (Pro) (Autohand AI, moa)', { timeout: 10_000 });
    expect(session.readAll()).not.toContain('Pro · Monthly');
    await session.type('/status');
    await session.press('enter');
    await session.waitForText('(tab to cycle)', { timeout: 10_000 });
    await session.press('tab');
    await session.press('tab');
    await session.waitForText('Autohand plan:', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Autohand Code Pro');
    expect(output).toContain('250 requests / 5 hours');
    expect(output).toContain('1K requests / 24 hours');
    expect(output).toContain('7K requests / week');
    expect(output).toContain('1K requests / minute');
    expect(output).toContain('500K uncached input tokens / minute');
    expect(output).toContain('80K output tokens / minute');
    expect(output).toContain('5-hour quota:');
    expect(output).toContain('12 used / 250');
    expect(output).toContain('24-hour quota:');
    expect(output).toContain('120 used / 1K');
    expect(output).toContain('Weekly quota:');
    expect(output).toContain('120 used / 7K');
    expect(output).toContain('Monthly quota:');
    expect(output).toContain('480 used / 21K');
    expect(output).not.toContain('autohandai:              not reported by provider');
    await session.press('escape');
    await waitForComposer(session);
    await exitInteractive(session);
  });

  it('opens every registered slash command suggestion and dismisses the menu with Escape', async () => {
    const session = await launchInteractive();
    const slashCommands = getHelpOrderedSlashCommands(SLASH_COMMANDS).map(
      (command) => command.command
    );

    await waitForComposer(session);

    for (const command of slashCommands) {
      await typeLikeUser(session, command);
      const menuScreen = await session.text({
        timeout: 10_000,
        waitFor: (text) => text.includes(command) && text.includes('Tab to accept'),
      });

      expect(menuScreen).toContain(command);
      await dismissAutocompleteMenu(session);
      const dismissedScreen = await session.text({ trimEnd: true });
      expect(dismissedScreen).not.toContain('Tab to accept');

      await clearComposerInput(session);
    }

    await exitInteractive(session);
  }, 240_000);

  it('shows effective values in /settings and lets the UI category change the theme', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    tempStates.push(state);
    expect((await fs.readJson(state.configPath)).ui.theme).toBeUndefined();
    const session = await trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await waitForComposer(session);
    await session.type('/settings');
    await session.press('enter');
    await session.waitForText('Select a category:', { timeout: 10_000 });
    await session.press('1');
    const rows = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Select a setting to change:') });
    expect(rows).toContain('Theme: aurora (default)');
    expect(rows).toContain('Show LLM thinking: off (default)');
    expect(rows).not.toMatch(/: \(default\)/);
    await session.press('escape');
    await session.waitForText('Select a category:');
    await session.press('escape');
    await waitForComposer(session);

    await selectThemeFromSettings(session, 'dracula');
    expect((await fs.readJson(state.configPath)).ui.theme).toBe('dracula');
    await exitInteractive(session);
  });

  it('selects the Sandy theme and renders the expected Sandy colors', async () => {
    const session = await launchInteractive({
      env: {
        NO_COLOR: undefined,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      },
    });

    await selectTheme(session, 'sandy');
    await session.waitForText('Theme preview:', { timeout: 10_000 });

    const output = session.readAll();
    const rawOutput = session.getRawOutput();

    expect(output).toContain("Theme changed to 'sandy'");
    expect(output).toContain('● accent');
    expect(rawOutput).toContain('[38;2;196;92;62m');
    expect(rawOutput).toContain('[48;2;74;58;42m');
    expect(rawOutput).toContain('[38;2;245;240;232m');

    await exitInteractive(session);
  });

  it('defaults to Aurora and restores an explicit Aurora selection after restart', async () => {
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    tempStates.push(state);
    expect((await fs.readJson(state.configPath)).ui.theme).toBeUndefined();
    const launch = () => trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NO_COLOR: undefined, FORCE_COLOR: '3', COLORTERM: 'truecolor', TERM: 'xterm-256color',
        AUTOHAND_API_URL: authServer.baseUrl,
        AUTOHAND_AUTH_URL: authServer.baseUrl,
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
      },
    }));
    const session = await launch();
    await waitForComposer(session);
    await session.type('A calm place to build');
    expect(await session.text({ only: { foreground: '#e4e5ec', background: '#222326' } }))
      .toContain('A calm place to build');
    expect(await session.text({ only: { foreground: '#9b9ef5' } })).toContain('▔');
    await clearComposerInput(session);
    await selectTheme(session, 'tuatara');
    await selectTheme(session, 'aurora');
    expect((await fs.readJson(state.configPath)).ui.theme).toBe('aurora');
    await exitInteractive(session);

    const restarted = await launch();
    await waitForComposer(restarted);
    await restarted.type('Aurora survives restart');
    expect(await restarted.text({ only: { foreground: '#e4e5ec', background: '#222326' } }))
      .toContain('Aurora survives restart');
    expect(await restarted.text({ only: { foreground: '#9b9ef5' } })).toContain('▔');
    await clearComposerInput(restarted);
    await restarted.type('/theme');
    await restarted.press('enter');
    await restarted.waitForText('aurora (current)');
    await restarted.press('escape');
    await restarted.waitForText('Theme selection cancelled.');
    expect((await fs.readJson(state.configPath)).ui.theme).toBe('aurora');
    await exitInteractive(restarted);
  });

  it('selects Tuatara, renders its composer, and restores it after restart', async () => {
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const state = await createTempAutohandHome({ config: { ui: { theme: 'tui', promptSuggestions: false } } });
    tempStates.push(state);
    const launch = () => trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NO_COLOR: undefined, FORCE_COLOR: '3', COLORTERM: 'truecolor', TERM: 'xterm-256color',
        AUTOHAND_API_URL: authServer.baseUrl,
        AUTOHAND_AUTH_URL: authServer.baseUrl,
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
      },
    }));
    const session = await launch();
    await selectTheme(session, 'tuatara');
    expect((await fs.readJson(state.configPath)).ui.theme).toBe('tuatara');
    await waitForComposer(session);
    await session.type('Review the Tuatara palette');
    expect(await session.text({ only: { foreground: '#dfdfcf', background: '#303c2d' } }))
      .toContain('Review the Tuatara palette');
    expect(await session.text({ only: { foreground: '#b7c98a' } })).toContain('▔');
    expect(session.getRawOutput()).toContain('[38;2;230;154;131m');
    await clearComposerInput(session);
    await session.type('/theme');
    await session.press('enter');
    await session.waitForText('tuatara (current)');
    await session.press('escape');
    await waitForComposer(session);
    expect((await fs.readJson(state.configPath)).ui.theme).toBe('tuatara');
    await exitInteractive(session);

    const restarted = await launch();
    await waitForComposer(restarted);
    await restarted.type('Tuatara survives restart');
    expect(await restarted.text({ only: { foreground: '#dfdfcf', background: '#303c2d' } }))
      .toContain('Tuatara survives restart');
    expect(await restarted.text({ only: { foreground: '#b7c98a' } })).toContain('▔');
    await exitInteractive(restarted);
  });

  it('preserves one visible copy of chat history across repeated slash menu cycles', async () => {
    const userMessage = 'Keep this history visible after the model picker.';
    const assistantMessage = 'MODEL_PICKER_HISTORY_SENTINEL';
    const preload = await createMockOpenRouterFetchPreload(assistantMessage);
    mockOpenRouterFetchPreloads.push(preload);
    const session = await launchInteractive({
      env: {
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${preload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
    });

    await waitForComposer(session);
    await session.type(userMessage);
    await session.press('enter');
    await session.waitForText(assistantMessage, { timeout: 60_000 });
    await waitForComposer(session);

    for (const modal of [
      { command: '/model', title: 'What would you like to change?' },
      { command: '/theme', title: 'Select a theme:' },
    ]) {
      await session.type(modal.command);
      await session.press('enter');
      await session.waitForText(modal.title, { timeout: 10_000 });
      await session.press('escape');
      await waitForComposer(session);
    }

    const screen = await session.text({ trimEnd: true });
    await exitInteractive(session);

    expect(screen, screen).toContain(userMessage);
    expect(screen, screen).toContain(assistantMessage);
    expect(screen.match(new RegExp(userMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(screen.match(new RegExp(assistantMessage, 'g'))).toHaveLength(1);
  });

  it('preserves visible chat history after saving /statusline settings', async () => {
    const userMessage = 'Keep this history visible after statusline settings.';
    const assistantMessage = 'STATUSLINE_HISTORY_SENTINEL';
    const preload = await createMockOpenRouterFetchPreload(assistantMessage);
    mockOpenRouterFetchPreloads.push(preload);
    const session = await launchInteractive({
      env: {
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${preload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
    });

    await waitForComposer(session);
    await session.type(userMessage);
    await session.press('enter');
    await session.waitForText(assistantMessage, { timeout: 60_000 });
    await waitForComposer(session);

    await session.type('/statusline');
    await session.press('enter');
    await session.waitForText('Provider and model', { timeout: 10_000 });
    await session.press('space');
    await session.press('enter');
    await waitForComposer(session);

    const screen = await session.text({ trimEnd: true });
    await exitInteractive(session);

    expect(screen, screen).toContain(userMessage);
    expect(screen, screen).toContain(assistantMessage);
    expect(screen.match(new RegExp(userMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(screen.match(new RegExp(assistantMessage, 'g'))).toHaveLength(1);
  });

  it('persists an Ollama model selection and restores it after restart', async () => {
    const selectedModel = 'tuistory-first:latest';
    const ollamaServer = await createMockOllamaServer([selectedModel, 'tuistory-second:latest']);
    mockServers.push(ollamaServer);
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'openrouter',
        ollama: {
          baseUrl: ollamaServer.baseUrl,
          model: 'previous-ollama:latest',
        },
      },
    });
    tempStates.push(state);
    const launchWithPersistedConfig = (): Promise<Session> => trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
        },
        waitForDataTimeout: 15_000,
      })
    );
    const session = await launchWithPersistedConfig();

    await waitForComposer(session);
    await session.type('/model');
    await session.press('enter');
    await session.waitForText('What would you like to change?', { timeout: 10_000 });
    await session.press('3');
    await session.waitForText('Choose an LLM provider', { timeout: 10_000 });
    await selectModalOptionByLabel(session, 'Ollama');
    await session.waitForText('Select a model', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText(`Using ollama model ${selectedModel}`, { timeout: 10_000 });
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Ollama, ${selectedModel})`),
    });

    const screen = await session.text({ trimEnd: true });
    expect(screen).toContain(`(Ollama, ${selectedModel})`);

    await exitInteractive(session);

    const savedConfig = await fs.readJson(state.configPath) as {
      provider?: string;
      ollama?: { model?: string };
    };
    expect(savedConfig.provider).toBe('ollama');
    expect(savedConfig.ollama?.model).toBe(selectedModel);

    const restartedSession = await launchWithPersistedConfig();
    await waitForComposer(restartedSession);
    const restartedScreen = await restartedSession.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Ollama, ${selectedModel})`),
      trimEnd: true,
    });
    expect(restartedScreen).toContain(`(Ollama, ${selectedModel})`);
    await exitInteractive(restartedSession);
  });

  it('persists an Anthropic provider selection and restores it after restart', async () => {
    const selectedModel = 'claude-sonnet-5';
    const apiKey = 'sk-ant-tuistory-key-long-enough';
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'openrouter',
      },
    });
    tempStates.push(state);
    const launchWithPersistedConfig = (): Promise<Session> => trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
        },
        waitForDataTimeout: 15_000,
      })
    );
    const session = await launchWithPersistedConfig();

    await waitForComposer(session);
    await session.type('/model');
    await session.press('enter');
    await session.waitForText('What would you like to change?', { timeout: 10_000 });
    await session.press('3');
    await session.waitForText('Choose an LLM provider', { timeout: 10_000 });
    await selectModalOptionByLabel(session, 'Anthropic');
    await session.waitForText('Enter your Anthropic API key', { timeout: 10_000 });
    await session.type(apiKey);
    await session.press('enter');
    await session.waitForText('Select a model', { timeout: 10_000 });
    await selectModalOptionByLabel(session, 'Claude Sonnet 5');
    await session.waitForText('Anthropic configured successfully!', { timeout: 10_000 });
    const screen = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Anthropic, ${selectedModel})`),
      trimEnd: true,
    });
    expect(screen).toContain(`(Anthropic, ${selectedModel})`);

    await exitInteractive(session);

    const savedConfig = await fs.readJson(state.configPath) as {
      provider?: string;
      anthropic?: { apiKey?: string; model?: string };
    };
    expect(savedConfig.provider).toBe('anthropic');
    expect(savedConfig.anthropic).toEqual(expect.objectContaining({
      apiKey,
      model: selectedModel,
    }));

    const restartedSession = await launchWithPersistedConfig();
    await waitForComposer(restartedSession);
    const restartedScreen = await restartedSession.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Anthropic, ${selectedModel})`),
      trimEnd: true,
    });
    expect(restartedScreen).toContain(`(Anthropic, ${selectedModel})`);
    await exitInteractive(restartedSession);
  });

  it('persists an Autohand AI provider selection and restores it after restart', async () => {
    const selectedModel = 'fantail';
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'openrouter',
        features: {
          autohand_inference: true,
        },
      },
    });
    tempStates.push(state);
    const launchWithPersistedConfig = (): Promise<Session> => trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
        },
        waitForDataTimeout: 15_000,
      })
    );
    const session = await launchWithPersistedConfig();

    await waitForComposer(session);
    await session.type('/model');
    await session.press('enter');
    await session.waitForText('What would you like to change?', { timeout: 10_000 });
    await session.press('3');
    await session.waitForText('Choose an LLM provider', { timeout: 10_000 });
    const providerScreen = await session.text({ trimEnd: true });
    // The provider list renders an "Autohand AI" section heading above the
    // option itself, so match the numbered row rather than the first line that
    // happens to mention the provider.
    const autohandAILine = providerScreen
      .split('\n')
      .find((line) => line.includes('Autohand AI') && MODAL_OPTION_ROW.test(line));
    const autohandAIShortcut = autohandAILine?.match(MODAL_OPTION_ROW)?.[1];
    expect(isModalNumericShortcut(autohandAIShortcut), providerScreen).toBe(true);
    if (!isModalNumericShortcut(autohandAIShortcut)) {
      throw new Error('The visible Autohand AI option does not expose a numeric shortcut');
    }
    await session.press(autohandAIShortcut);
    await session.waitForText('Choose an Autohand plan', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('Select a model', { timeout: 10_000 });
    await session.press('1');
    await session.waitForText('Autohand AI configured successfully!', { timeout: 10_000 });
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Autohand AI, ${selectedModel})`),
    });

    const screen = await session.text({ trimEnd: true });
    expect(screen).toContain(`(Autohand AI, ${selectedModel})`);

    await exitInteractive(session);

    const savedConfig = await fs.readJson(state.configPath) as {
      provider?: string;
      autohandai?: { model?: string };
    };
    expect(savedConfig.provider).toBe('autohandai');
    expect(savedConfig.autohandai?.model).toBe(selectedModel);

    const restartedSession = await launchWithPersistedConfig();
    await waitForComposer(restartedSession);
    const restartedScreen = await restartedSession.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`(Autohand AI, ${selectedModel})`),
      trimEnd: true,
    });
    expect(restartedScreen).toContain(`(Autohand AI, ${selectedModel})`);
    await exitInteractive(restartedSession);
  });
});
