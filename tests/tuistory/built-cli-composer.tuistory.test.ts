/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import { openGoalsPanel } from '../../src/testing/scenarios/goalsCommandScenario.js';
import { TIP_ROTATION_MS } from '../../src/ui/tips.js';
import {
  clearComposerInput,
  createMockAutohandAINativeSequenceServer,
  createMockAuthServer,
  createMockOpenRouterServer,
  createMockOpenRouterSequenceServer,
  createStalledSyncFetchPreload,
  createTempAutohandHome,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
} from './helpers/autohandTuistory.js';
import {
  cachedAnnouncements,
  composerLineIncludes,
  idleTipOf,
  launchInteractive,
  launchWithCachedAnnouncements,
  linesContaining,
  mockAuthServers,
  mockOpenRouterFetchPreloads,
  mockServers,
  registerBuiltCliCleanup,
  rowAboveComposer,
  sampleImmediateScreens,
  tempStates,
  trackSession,
  typeLikeUser,
  waitForComposer,
  waitForCursorAfterTypedText,
  waitForCursorPositionQuery,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

describe('interactive built CLI Tuistory tests: composer, tips, announcements, auth, and goals', () => {


  it('answers the first message and exits promptly while an MCP server never finishes its handshake', async () => {
    const openRouterServer = await createMockOpenRouterServer('MCP gate cleared.');
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { sessionRetryLimit: 0 },
        mcp: {
          enabled: true,
          servers: [{
            name: 'hung',
            transport: 'stdio',
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 120000)'],
          }],
        },
      },
    });
    await waitForComposer(session);

    await session.type('Is startup blocked?');
    const submittedAt = Date.now();
    await session.press('enter');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('MCP gate cleared.'),
    });
    expect(Date.now() - submittedAt).toBeLessThan(8_000);

    const exitRequestedAt = Date.now();
    await exitInteractive(session);
    expect(Date.now() - exitRequestedAt).toBeLessThan(6_000);
  });

  it('follows the Codex shortcut profile: Ctrl+J inserts a newline, ? lists it, Ctrl+D exits', async () => {
    const session = await launchInteractive({
      config: { ui: { keybindingProfile: 'codex', promptSuggestions: false } },
    });
    await waitForComposer(session);

    await session.type('first');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯ first') });
    session.writeRaw('\n');
    // Wait for Ctrl+J's empty second line above the composer border before typing again.
    // Under load the raw newline and the next keystroke can arrive as one chunk and be
    // read as pasted input, which drops the newline ("firstecond").
    await session.text({ timeout: 10_000, waitFor: (text) => /❯ first\n[ \t]*\n[ \t]*▁/.test(text) });
    await session.type('second');
    const multilineScreen = await session.text({
      timeout: 20_000,
      waitFor: (text) => text.includes('first') && text.includes('second'),
      trimEnd: true,
    });
    expect(multilineScreen).toMatch(/❯ first\n\s*second/);

    await clearComposerInput(session);
    await session.type('?');
    const helpScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('? shortcuts'),
      trimEnd: true,
    });
    expect(helpScreen).toContain('ctrl + j inserts newline');
    expect(helpScreen).toContain('ctrl + d exits');
    await session.press('escape');

    await session.press(['ctrl', 'd']);
    await waitForExit(session, 15_000);
    expectCleanExit(session);
  });

  it('keeps working-turn status refreshes from refocusing a drafted composer', async () => {
    const openRouterServer = await createMockOpenRouterServer(
      'Delayed response completed.',
      4_000,
    );
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { sessionRetryLimit: 0 },
      },
    });
    await waitForComposer(session);

    await session.type('Run a delayed response while I inspect the chat history.');
    await session.press('enter');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('esc to cancel'),
    });
    await session.type('preserve this draft');
    await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'preserve this draft'),
    });

    const outputStart = session.getRawOutput().length;
    await new Promise<void>((resolve) => setTimeout(resolve, 2_200));
    const refreshOutput = session.getRawOutput().slice(outputStart);

    expect(stripAnsi(refreshOutput)).toMatch(/\b0m 0[12]s\b/u);
    expect(refreshOutput).not.toContain('\x1b[?25h');

    const completionOutputStart = session.getRawOutput().length;
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('Delayed response completed.'),
    });
    const completionOutput = session.getRawOutput().slice(completionOutputStart);
    expect(completionOutput).not.toContain('\x1b[?25h');

    await session.type('!');
    await waitForCursorAfterTypedText(session, 'preserve this draft!');
    await exitInteractive(session);
  });



  it('rotates a tip beside the idle composer, hides it during a turn, and brings it back on the completion row', async () => {
    const openRouterServer = await createMockOpenRouterServer('Tip check completed.', 4_000);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { sessionRetryLimit: 0 },
        ui: { showTips: true },
      },
    });
    await waitForComposer(session);

    const startup = await session.text({ timeout: 10_000, waitFor: (text) => idleTipOf(text) !== undefined });
    const firstTip = idleTipOf(startup);
    const rotated = await session.text({
      timeout: TIP_ROTATION_MS + 10_000,
      waitFor: (text) => {
        const tip = idleTipOf(text);
        return tip !== undefined && tip !== firstTip;
      },
    });
    expect(idleTipOf(rotated)).not.toBe(firstTip);

    await session.type('Run a delayed response so I can read the tip.');
    await session.press('enter');
    const working = stripAnsi(await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('esc to cancel'),
    }));
    expect(working).not.toContain('Tip: ');

    const finished = await session.text({
      timeout: 15_000,
      waitFor: (text) => text.includes('Tip check completed.')
        && !text.includes('esc to cancel')
        && idleTipOf(text) !== undefined,
    });
    expect(rowAboveComposer(finished)).toMatch(/^Completed in .+ {2,}Tip: /u);

    // The first summary moves into the transcript when the next turn starts, and
    // the second turn keeps its own summary on the row above the composer.
    await session.type('Run it once more so the second summary lands.');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });
    const secondFinish = await session.text({
      timeout: 20_000,
      waitFor: (text) => {
        const screen = stripAnsi(text);
        return !screen.includes('esc to cancel')
          && (screen.match(/Completed in /gu)?.length ?? 0) >= 2
          && idleTipOf(screen) !== undefined;
      },
    });
    // The first summary stays in the transcript, the second keeps the live row.
    const summaryLines = stripAnsi(secondFinish).split('\n').filter((line) => line.includes('Completed in '));
    expect(summaryLines.length).toBeGreaterThanOrEqual(2);
    expect(rowAboveComposer(secondFinish)).toMatch(/^Completed in .+ {2,}Tip: /u);

    await exitInteractive(session);
  }, 150_000);

  it('opens the console upgrade link for the next plan from /upgrade', async () => {
    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);
    const session = await launchInteractive({
      config: {
        provider: 'openai',
        openai: { apiKey: 'tuistory-test-api-key', model: 'gpt-5.5' },
        auth: {
          token: 'tuistory-account-token',
          user: { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' },
        },
      },
      env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
    });
    await waitForComposer(session);

    await session.type('/upgrade');
    await session.press('enter');
    // The mock account is on Pro, so the next plan is Max. AUTOHAND_NO_BROWSER
    // makes the opener print the link instead of launching a browser.
    const output = stripAnsi(await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('upgrade=max'),
    }));
    expect(output).toContain('https://console.autohand.ai/?upgrade=max&source=cli');

    await exitInteractive(session);
  });



  it('renders a cached launch block and persistent top-priority announcement line', async () => {
    const session = await launchWithCachedAnnouncements();

    await waitForComposer(session);
    const output = session.readAll();
    const screen = await session.text({ trimEnd: true });

    expect(output).toContain("What's new  ·  Voice dictation is here");
    expect(output).toContain('+1 more · /whatsnew');
    expect(screen).toContain('Voice dictation is here');
    expect(screen).toContain('^X hide  /whatsnew');

    await exitInteractive(session);
  });

  it('dismisses with Ctrl+X without modifying composer input and advances the line', async () => {
    const session = await launchWithCachedAnnouncements();
    await waitForComposer(session);
    await session.type('preserve this draft');
    await waitForCursorAfterTypedText(session, 'preserve this draft');

    await session.press(['ctrl', 'x']);
    const screen = await session.text({
      timeout: 10_000,
      showCursor: true,
      trimEnd: true,
      waitFor: (text) => text.includes('Squad mode is ready') && text.includes('preserve this draft'),
    });

    expect(composerLineIncludes(screen, 'preserve this draft')).toBe(true);
    const liveAnnouncementLines = screen.split('\n').filter((line) => line.includes('^X hide'));
    expect(liveAnnouncementLines).toHaveLength(1);
    expect(liveAnnouncementLines[0]).toContain('Squad mode is ready');
    expect(liveAnnouncementLines[0]).not.toContain('Voice dictation is here');

    await exitInteractive(session);
  });

  it('does not treat the Enter that submits /whatsnew as an announcement dismissal', async () => {
    const session = await launchWithCachedAnnouncements();
    await waitForComposer(session);

    await session.type('/whatsnew');
    await session.press('enter');
    const modal = await session.text({
      timeout: 10_000,
      waitFor: (text) => (
        text.includes("What's new")
        && text.includes('Voice dictation is here')
        && text.includes('Squad mode is ready')
      ),
      trimEnd: true,
    });

    expect(modal).toContain('Voice dictation is here');
    expect(modal).toContain('Squad mode is ready');

    await session.press('escape');
    const restored = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('❯') && text.includes('Voice dictation is here'),
      trimEnd: true,
    });

    expect(restored).toContain('Voice dictation is here');
    await exitInteractive(session);
  });

  it('opens /whatsnew, dismisses the selection, and restores the composer on Escape', async () => {
    const session = await launchWithCachedAnnouncements();
    await waitForComposer(session);

    await session.type('/whatsnew');
    await session.press('enter');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes("What's new") && text.includes('enter dismiss'),
    });
    await session.press('enter');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => (
        text.includes("What's new")
        && text.includes('Squad mode is ready')
        && !text.includes('Voice dictation is here')
      ),
    });
    await session.press('escape');
    const restored = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('❯') && text.includes('Squad mode is ready'),
      trimEnd: true,
    });

    expect(restored).toContain('❯');
    expect(restored).toContain('Squad mode is ready');
    await exitInteractive(session);
  });

  it('reserves no announcement row when the cache is empty', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    const screen = await session.text({ trimEnd: true });
    expect(screen).not.toContain('^X hide');
    expect(screen).not.toContain('/whatsnew');

    await exitInteractive(session);
  });

  it('prints no cached announcement in prompt command mode', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      'Command mode completed without announcement output.',
    ]);
    mockServers.push(openRouterServer);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
      },
    });
    tempStates.push(state);
    await writeFile(
      path.join(state.autohandHome, 'announcements.json'),
      JSON.stringify({ announcements: cachedAnnouncements, dismissedIds: [] }, null, 2),
    );
    const session = await trackSession(launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--offline',
      '--prompt',
      'Run command mode.',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('Command mode completed without announcement output.', { timeout: 20_000 });
    await waitForExit(session, 20_000);
    const output = session.readAll();
    expect(output).not.toContain('Voice dictation is here');
    expect(output).not.toContain("What's new");
    expectCleanExit(session);
  });

  it('starts the interactive TUI without real auth, network, or user home state', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('Autohand');
    expect(screen).toContain('model:');

    await exitInteractive(session);
  });

  it('keeps the workspace path and git branch visible after status synchronization', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: state.workspaceRoot,
      encoding: 'utf8',
    }).trim();
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NO_COLOR: undefined,
          FORCE_COLOR: '3',
          COLORTERM: 'truecolor',
          TERM: 'xterm-256color',
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.text({
      timeout: 15_000,
      waitFor: (text) => text.split('\n').some((line) => (
        line.includes('! terminal')
        && line.includes('/workspace')
        && line.includes(branch)
      )),
    });

    for (const screen of await sampleImmediateScreens(session, 1_200)) {
      const helpLine = screen.split('\n').find((line) => line.includes('! terminal'));
      expect(helpLine, screen).toContain('/workspace');
      expect(helpLine, screen).toContain(branch);
    }

    await exitInteractive(session);
  }, 60_000);

  it('cycles Shift+Tab through plan, automode, yolo, and default', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);

    for (const indicator of ['[PLAN]', '[AUTO]', '[YOLO]']) {
      await session.press(['shift', 'tab']);
      const screen = await session.text({
        timeout: 5_000,
        waitFor: (text) => text.includes(indicator),
        trimEnd: true,
      });
      expect(screen).toContain(indicator);
    }

    await session.press(['shift', 'tab']);
    const defaultScreen = await session.text({
      timeout: 5_000,
      waitFor: (text) => (
        text.includes('❯')
        && !text.includes('[PLAN]')
        && !text.includes('[YOLO]')
        && !text.includes('[AUTO]')
      ),
      trimEnd: true,
    });

    expect(defaultScreen).not.toContain('[PLAN]');
    expect(defaultScreen).not.toContain('[YOLO]');
    expect(defaultScreen).not.toContain('[AUTO]');

    await exitInteractive(session);
  });

  it('continues an active goal after a non-terminal model response', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'The goal needs implementation work after this planning turn.',
        toolCalls: [],
        finalResponse: 'FIRST_GOAL_TURN_FINISHED',
      }),
      JSON.stringify({
        thought: 'The implementation is now complete, so the persistent goal can be completed.',
        toolCalls: [{ tool: 'update_goal', args: { status: 'complete' } }],
      }),
      JSON.stringify({
        toolCalls: [],
        finalResponse: 'GOAL_CONTINUATION_FINISHED',
      }),
    ]);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        features: { slashGoal: true },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/goal build a toddler-friendly browser game');
    await session.press('enter');
    await session.waitForText('Goal created.', { timeout: 10_000 });
    await session.waitForText('FIRST_GOAL_TURN_FINISHED', { timeout: 15_000 });
    await session.waitForText('GOAL_CONTINUATION_FINISHED', { timeout: 5_000 });

    await waitForComposer(session);
    await session.type('/goal');
    await session.press('enter');
    await session.waitForText('Status: complete', { timeout: 5_000 });

    const output = session.readAll();
    expect(output).toContain('Interactive auto mode active');
    expect(output).toContain('GOAL_CONTINUATION_FINISHED');
    expect(output.match(/GOAL_CONTINUATION_FINISHED/gu)).toHaveLength(1);

    await exitInteractive(session);
  }, 45_000);

  it('starts a stranded queued goal from bare /goal without dumping the failure transcript', async () => {
    const queuedObjective = [
      'fix the failing Windows installer test and commit the repair',
      'Process completed with exit code 1.',
      'tests/windowsInstaller.spec.ts:208 AssertionError',
      'FULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER',
    ].join('\n');
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        toolCalls: [],
        finalResponse: 'STRANDED_QUEUED_GOAL_STARTED',
      }),
    ]);
    mockServers.push(openRouterServer);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        features: { slashGoal: true },
        agent: {
          autoMemory: false,
          goalAutoMode: false,
          maxIterations: 2,
          sessionRetryLimit: 0,
        },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });
    tempStates.push(state);
    const now = Date.now();
    await fs.outputJson(path.join(state.workspaceRoot, '.autohand', 'goals.local.json'), {
      version: 1,
      goal: {
        goalId: 'offline-peer-goal',
        objective: 'work owned by an offline session',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      },
      queue: [{
        queueId: 'queued-failing-test',
        objective: queuedObjective,
        source: 'command',
        createdAt: now,
      }],
      completed: [],
      updatedAt: now,
      activeSessionId: 'offline-session',
    });
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      }),
    );

    await waitForComposer(session);
    await session.type('/goal');
    await session.press('enter');
    await session.waitForText('Started queued goal.', { timeout: 5_000 });
    await session.waitForText('STRANDED_QUEUED_GOAL_STARTED', { timeout: 15_000 });

    const output = session.readAll();
    expect(output).toContain('fix the failing Windows installer test');
    expect(output).not.toContain('FULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER');

    await exitInteractive(session);
  }, 45_000);

  it('enables slash_goals, opens /goals, and edits a chained goal with the mouse', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        toolCalls: [],
        finalResponse: 'FIRST_GOAL_TURN_IDLE',
      }),
    ]);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: {
          autoMemory: false,
          goalAutoMode: false,
          maxIterations: 2,
          sessionRetryLimit: 0,
        },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          mouseComposerCursor: true,
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/experiments enable slash_goals');
    await session.press('enter');
    await session.waitForText('Enabled slash_goal.', { timeout: 5_000 });

    await waitForComposer(session);
    await session.type('/goal ship the first queue item');
    await session.press('enter');
    await session.waitForText('Goal created.', { timeout: 5_000 });
    await session.waitForText('FIRST_GOAL_TURN_IDLE', { timeout: 15_000 });

    await waitForComposer(session);
    await session.type('/goal ship the second queue item');
    await session.press('enter');
    await session.waitForText('Queued goal.', { timeout: 5_000 });

    await openGoalsPanel(session);
    await session.waitForText('Goals · 2 total', { timeout: 5_000 });
    await session.waitForText('ship the first queue item', { timeout: 5_000 });
    await session.waitForText('ship the second queue item', { timeout: 5_000 });

    const terminalData = session.getTerminalData();
    const queueRow = terminalData.lines
      .map((line, row) => ({
        row,
        text: line.spans.map((span) => span.text).join(''),
      }))
      .find((line) => line.text.includes('2. ship the second queue item queued'));
    if (!queueRow) {
      throw new Error('expected the queued goal row to be visible');
    }
    const viewportStart = Math.max(0, terminalData.totalLines - terminalData.rows);
    expect(queueRow.row).toBeGreaterThanOrEqual(viewportStart);
    await session.clickAt(
      queueRow.text.indexOf('ship the second queue item'),
      queueRow.row - viewportStart,
    );
    await waitForCursorPositionQuery(session);
    const [terminalCursorColumn, terminalCursorRow] = session.getTerminalData().cursor;
    session.writeRaw(`\x1b[${terminalCursorRow + 1};${terminalCursorColumn + 1}R`);
    await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, 'ship the second queue item'),
    });

    await session.type(' after review');
    await session.press('enter');
    await session.waitForText('ship the second queue item after review', { timeout: 5_000 });

    const output = session.readAll();
    expect(output).toContain('Goals · 2 total');
    expect(output).toContain('enter edit · click edit');

    await exitInteractive(session);
  }, 45_000);

  it('starts device auth from the startup auth gate', async () => {
    const state = await createTempAutohandHome({
      config: {
        auth: {
          token: '',
        },
      },
    });
    tempStates.push(state);

    const authServer = await createMockAuthServer();
    mockAuthServers.push(authServer);

    const fakeBinDir = path.join(state.autohandHome, 'fake-bin');
    await mkdir(fakeBinDir, { recursive: true });
    for (const launcher of ['open', 'xdg-open']) {
      const fakeLauncherPath = path.join(fakeBinDir, launcher);
      await writeFile(fakeLauncherPath, '#!/bin/sh\nexit 0\n');
      await chmod(fakeLauncherPath, 0o755);
    }

    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/v1/auth`,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Sign in to continue.', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('TEST-CAFE', { timeout: 10_000 });
    await session.waitForText('Waiting for authorization', { timeout: 10_000 });
  });

  it('loads an interactive composer after negotiating the production device auth schema', async () => {
    const state = await createTempAutohandHome({
      config: {
        auth: {
          token: '',
        },
      },
    });
    tempStates.push(state);

    const authServer = await createMockAuthServer({
      authorizeAfterPolls: 1,
      deviceAuthSchemaVersion: 1,
    });
    mockAuthServers.push(authServer);
    const stalledSyncPreload = await createStalledSyncFetchPreload();
    mockOpenRouterFetchPreloads.push(stalledSyncPreload);

    const fakeBinDir = path.join(state.autohandHome, 'fake-bin');
    await mkdir(fakeBinDir, { recursive: true });
    for (const launcher of ['open', 'xdg-open']) {
      const fakeLauncherPath = path.join(fakeBinDir, launcher);
      await writeFile(fakeLauncherPath, '#!/bin/sh\nexit 0\n');
      await chmod(fakeLauncherPath, 0o755);
    }

    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/v1/auth`,
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            `--import ${stalledSyncPreload.importSpecifier}`,
          ].filter(Boolean).join(' '),
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Sign in to continue.', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('Successfully logged in as Authorized Tuistory User', { timeout: 10_000 });
    await session.text({
      timeout: 5_000,
      waitFor: (text) => text.includes('❯'),
    });

    const prompt = 'post login input';
    await typeLikeUser(session, prompt);
    const screen = await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, prompt),
      trimEnd: true,
    });

    expect(screen).toContain('❯');
    expect(screen).toContain(prompt);

    await exitInteractive(session);
  });

  it('keeps the themed composer background inside its accent rules', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          theme: 'dracula',
          promptSuggestions: false,
        },
      },
      env: {
        FORCE_COLOR: '3',
        NO_COLOR: undefined,
      },
    });

    await waitForComposer(session);

    const prompt = 'themed input field';
    await typeLikeUser(session, prompt);
    await session.text({
      timeout: 5_000,
      waitFor: (text) => composerLineIncludes(text, prompt),
    });

    const composerBackground = await session.text({
      only: { background: '#44475a' },
      trimEnd: true,
    });
    const composerAccent = await session.text({
      only: { foreground: '#bd93f9' },
      trimEnd: true,
    });
    const screen = await session.text({ trimEnd: true });
    const screenLines = screen.split('\n');
    const promptRow = screenLines.findIndex((line) => line.includes(prompt));

    expect(composerBackground).toContain(`❯ ${prompt}`);
    expect(linesContaining(composerBackground, '▔')).toHaveLength(1);
    expect(linesContaining(composerBackground, '▁')).toHaveLength(1);
    expect(linesContaining(composerAccent, '▁')).toHaveLength(1);
    expect(linesContaining(composerAccent, '▔')).toHaveLength(1);
    expect(promptRow).toBeGreaterThan(0);
    expect(screenLines[promptRow - 1]).toContain('▔');
    expect(screenLines[promptRow + 1]).toContain('▁');
    expect(screenLines[promptRow + 2]).toContain('Autohand (');

    await exitInteractive(session);
  });

  it('opens the experiments menu on Enter while the subcommand suggestions are showing', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/experiments ');
    await session.waitForText('/experiments list', { timeout: 5_000 });
    await session.press('enter');

    // The suggestions stay for discovery, but Enter on the bare command runs
    // it instead of filling in whichever subcommand happens to be highlighted.
    await session.waitForText('Experiments - space toggles, enter closes', { timeout: 10_000 });
    expect(stripAnsi(session.getRawOutput())).not.toContain('Usage: /experiments');

    await session.press('escape');
    await waitForComposer(session);
    await exitInteractive(session);
  });

  it.each([
    { showThinking: undefined, expectsThought: false },
    { showThinking: false, expectsThought: false },
    { showThinking: true, expectsThought: true },
  ])('keeps inline <think> blocks from a cloud reasoning model out of the reply (showThinking=$showThinking)', async ({ showThinking, expectsThought }) => {
    const nativeServer = await createMockAutohandAINativeSequenceServer([
      { content: '<think>\nMOA_DRAFT_THOUGHT weighs two jokes.\n</think>\n\nMOA_FINAL_ANSWER light attracts bugs.' },
    ]);
    mockServers.push(nativeServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: nativeServer.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          ...(showThinking === undefined ? {} : { showThinking }),
          terminalBell: false,
        },
      },
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
    await session.type('tell me a joke');
    await session.press('enter');
    const screen = await session.text({
      timeout: 15_000,
      waitFor: (text) => text.includes('MOA_FINAL_ANSWER'),
    });

    // The draft belongs to the reasoning channel, never to the reply text;
    // it is shown as a dim thinking line only when the setting is on.
    expect(screen).not.toContain('</think>');
    expect(screen).not.toContain('<think>');
    expect(screen.includes('MOA_DRAFT_THOUGHT'), screen).toBe(expectsThought);
    if (expectsThought) {
      expect(screen).toContain('Thinking: MOA_DRAFT_THOUGHT');
    }

    await exitInteractive(session);
  });

  it('names the session with /rename, lists it by that name, and honours --rename from a script', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    tempStates.push(state);
    const launch = () => trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    let session = await launch();
    await waitForComposer(session);
    await session.type('/rename Ship the caret fix');
    await session.press('enter');
    await session.waitForText('Session renamed to "Ship the caret fix".', { timeout: 10_000 });
    await session.type('/session');
    await session.press('enter');
    await session.waitForText('Name:', { timeout: 10_000 });
    expect(await session.text({ immediate: true })).toContain('Ship the caret fix');
    await session.type('/sessions');
    await session.press('enter');
    await session.waitForText('Ship the caret fix', { timeout: 10_000 });
    await exitInteractive(session);

    const sessionsDir = path.join(state.autohandHome, 'sessions');
    const index = await fs.readJson(path.join(sessionsDir, 'index.json'));
    expect(index.sessions.map((entry: { title?: string }) => entry.title)).toContain('Ship the caret fix');

    session = await trackSession(launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--rename', 'Renamed from a script'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));
    await waitForExit(session, 15_000);
    expectCleanExit(session);
    expect(session.readAll()).toContain('renamed to "Renamed from a script"');
    const [entry] = index.sessions as { id: string }[];
    expect((await fs.readJson(path.join(sessionsDir, entry.id, 'metadata.json'))).title).toBe('Renamed from a script');
  });
});
