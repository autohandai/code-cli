/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import { getHelpOrderedSlashCommands } from '../../src/ui/inputPrompt.js';
import {
  clearComposerInput,
  createMockAuthServer,
  createMockOpenRouterFetchPreload,
  createMockOpenRouterSequenceServer,
  createMockSkillInstallFetchPreload,
  createMockOllamaServer,
  createStalledSyncFetchPreload,
  createTempAutohandHome,
  dismissAutocompleteMenu,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
  type CreateTempAutohandHomeOptions,
  type MockAuthServer,
  type MockOllamaServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const mockAuthServers: MockAuthServer[] = [];
const mockServers: MockOllamaServer[] = [];
const mockOpenRouterFetchPreloads: Array<{ cleanup: () => Promise<void> }> = [];
const mockResearchEvidenceServers: Array<{ close: () => Promise<void> }> = [];
const CURSOR_CHAR = '█';

async function trackSession(sessionPromise: Promise<Session>): Promise<Session> {
  const session = await sessionPromise;
  sessions.push(session);
  return session;
}

async function typeLikeUser(session: Session, text: string): Promise<void> {
  for (const char of text) {
    await session.type(char);
  }
}

function expectCursorAfterTypedText(screen: string, typedText: string): void {
  const typedLine = screen.split('\n').find((line) => (
    line.includes('❯') &&
    line.includes(typedText)
  ));

  expect(typedLine, screen).toBeTruthy();
  expect(typedLine?.includes(CURSOR_CHAR), screen).toBe(true);

  const textColumn = typedLine?.indexOf(typedText) ?? -1;
  const cursorColumn = typedLine?.indexOf(CURSOR_CHAR) ?? -1;

  expect(cursorColumn, screen).toBeGreaterThanOrEqual(textColumn + typedText.length);
}

function composerLineIncludes(screen: string, text: string): boolean {
  return screen.split('\n').some((line) => line.includes('❯') && line.includes(text));
}

async function waitForCursorAfterTypedText(session: Session, typedText: string): Promise<string> {
  const visibleText = typedText.trimEnd();
  const deadline = Date.now() + 2_000;
  let screen = '';

  while (Date.now() < deadline) {
    screen = await session.text({
      immediate: true,
      showCursor: true,
      trimEnd: true,
    });

    if (
      screen.includes(CURSOR_CHAR) &&
      screen.split('\n').some((line) => (
        line.includes('❯') &&
        line.includes(visibleText) &&
        line.includes(CURSOR_CHAR)
      ))
    ) {
      expectCursorAfterTypedText(screen, visibleText);
      return screen;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expectCursorAfterTypedText(screen, visibleText);
  return screen;
}

function linesContaining(screen: string, text: string): string[] {
  return screen.split('\n').filter((line) => line.includes(text));
}

async function sampleImmediateScreens(
  session: Session,
  durationMs: number,
  intervalMs = 50,
): Promise<string[]> {
  const deadline = Date.now() + durationMs;
  const screens: string[] = [];

  while (Date.now() < deadline) {
    screens.push(await session.text({
      immediate: true,
      showCursor: true,
      trimEnd: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return screens;
}

function expectStableSingleComposerFrames(screens: string[]): void {
  expect(screens.length).toBeGreaterThan(0);

  for (const screen of screens) {
    expect(linesContaining(screen, '❯'), screen).toHaveLength(1);
    expect(screen, screen).not.toContain('[memory] turn reflection');
  }
}

async function createMockResearchEvidenceServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url === '/hermes') {
      response.writeHead(200, { 'content-type': 'text/markdown' });
      response.end('# Hermes self evolving\n\nHermes self-evolving research uses iterative critique and improvement loops.\n');
      return;
    }

    if (request.url === '/dspy') {
      response.writeHead(200, { 'content-type': 'text/markdown' });
      response.end('# DSPy\n\nDSPy provides declarative modules and optimizers for language model programs.\n');
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock research evidence server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const server of mockServers.splice(0)) {
    await server.close();
  }
  for (const server of mockAuthServers.splice(0)) {
    await server.close();
  }
  for (const server of mockResearchEvidenceServers.splice(0)) {
    await server.close();
  }
  for (const preload of mockOpenRouterFetchPreloads.splice(0)) {
    await preload.cleanup();
  }
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

describe('built CLI Tuistory smoke tests', () => {
  it('renders help from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--help'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('Usage', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Usage');
    expect(output).toContain('--prompt');
    expect(output).toContain('--mode');
    expect(output).toContain('--help');
    expect(output).toContain('--version');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('renders version from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--version'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText(packageJson.version, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain(packageJson.version);
    expect(output).toMatch(/\d+\.\d+\.\d+ \((?:[0-9a-f]{7,40}|unknown)\)/);

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('opens the active agents dashboard and exits with Escape', async () => {
    const state = await createTempAutohandHome({ initializeGit: false });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand(['agents'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('No active Autohand agents found.', { timeout: 10_000 });
    await session.press('escape');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('installs a direct skill from Skilled when the primary CLI registry misses', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const preload = await createMockSkillInstallFetchPreload();
    mockOpenRouterFetchPreloads.push(preload);

    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--import ${preload.importSpecifier}`,
    ].filter(Boolean).join(' ');
    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--skill-install',
        'dotnet-aspnetcore',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: nodeOptions,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Install location', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('Validating source files', { timeout: 10_000 });
    await session.waitForText('Installing validated files', { timeout: 10_000 });
    await session.waitForText('Installed dotnet-aspnetcore', { timeout: 10_000 });
    await session.waitForText('Would you like to use the skill "dotnet-aspnetcore" now?', { timeout: 10_000 });
    await session.press('enter');

    await waitForExit(session);
    expectCleanExit(session);

    const installedSkillPath = path.join(
      state.autohandHome,
      'skills',
      'dotnet-aspnetcore',
      'SKILL.md'
    );
    expect(await fs.pathExists(installedSkillPath)).toBe(true);
    expect(await fs.readFile(installedSkillPath, 'utf8')).toContain('Tuistory skill body.');
  });

  it('installs a direct skill with --y and opens the interactive TUI with the skill active', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const preload = await createMockSkillInstallFetchPreload();
    mockOpenRouterFetchPreloads.push(preload);

    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--import ${preload.importSpecifier}`,
    ].filter(Boolean).join(' ');
    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--skill-install',
        'dotnet-aspnetcore',
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: nodeOptions,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Installed dotnet-aspnetcore', { timeout: 10_000 });
    await session.waitForText('❯', { timeout: 20_000 });
    const initialInteractiveScreen = await session.text({ immediate: true, trimEnd: true });
    expect(initialInteractiveScreen).not.toContain('Would you like to use the skill');

    await session.type('/skills info dotnet-aspnetcore');
    await session.press('enter');
    await session.waitForText('Status:', { timeout: 10_000 });
    await session.waitForText('Active', { timeout: 10_000 });

    await exitInteractive(session);

    const installedSkillPath = path.join(
      state.autohandHome,
      'skills',
      'dotnet-aspnetcore',
      'SKILL.md'
    );
    expect(await fs.pathExists(installedSkillPath)).toBe(true);
  });
});

describe('interactive built CLI Tuistory tests', () => {
  async function launchInteractive(options: {
    config?: CreateTempAutohandHomeOptions['config'];
    env?: Record<string, string | undefined>;
  } = {}): Promise<Session> {
    const state = await createTempAutohandHome({ config: options.config });
    tempStates.push(state);
    return await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: options.env,
        waitForDataTimeout: 15_000,
      })
    );
  }

  async function waitForComposer(session: Session): Promise<void> {
    await session.text({
      timeout: 20_000,
      waitFor: (text) => text.includes('❯'),
    });
  }

  it('starts the interactive TUI without real auth, network, or user home state', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('Autohand');
    expect(screen).toContain('model:');

    await exitInteractive(session);
  });

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
    const fakeOpenPath = path.join(fakeBinDir, 'open');
    await writeFile(fakeOpenPath, '#!/bin/sh\nexit 0\n');
    await chmod(fakeOpenPath, 0o755);

    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Sign in to continue.', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('TUI-123', { timeout: 10_000 });
    await session.waitForText('Waiting for authorization', { timeout: 10_000 });
  });

  it('loads an interactive composer after successful startup device auth', async () => {
    const state = await createTempAutohandHome({
      config: {
        auth: {
          token: '',
        },
      },
    });
    tempStates.push(state);

    const authServer = await createMockAuthServer({ authorizeAfterPolls: 1 });
    mockAuthServers.push(authServer);
    const stalledSyncPreload = await createStalledSyncFetchPreload();
    mockOpenRouterFetchPreloads.push(stalledSyncPreload);

    const fakeBinDir = path.join(state.autohandHome, 'fake-bin');
    await mkdir(fakeBinDir, { recursive: true });
    const fakeOpenPath = path.join(fakeBinDir, 'open');
    await writeFile(fakeOpenPath, '#!/bin/sh\nexit 0\n');
    await chmod(fakeOpenPath, 0o755);

    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
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

  it('keeps multiline, large paste, and image paste placeholders intact in the real prompt', async () => {
    const session = await launchInteractive({
      config: {
        ui: {
          promptSuggestions: false,
        },
      },
    });

    await waitForComposer(session);
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
        text.includes('autohand (') &&
        !text.includes('Wandering')
      ),
      trimEnd: true,
    });

    expect(linesContaining(screen, '❯'), screen).toHaveLength(1);
    expect(linesContaining(screen, 'autohand ('), screen).toHaveLength(1);
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
    const permissionOrSaved = await session.text({
      timeout: 30_000,
      waitFor: (text) => (
        text.includes(`Create new file ${reportPath}?`) ||
        text.includes(`Research saved: ${reportPath}`)
      ),
    });
    if (permissionOrSaved.includes(`Create new file ${reportPath}?`)) {
      await session.press('enter');
    }
    await session.waitForText(`Research saved: ${reportPath}`, { timeout: 30_000 });

    const savedReportPath = path.join(state.workspaceRoot, reportPath);
    expect(existsSync(savedReportPath)).toBe(true);
    const savedReport = await readFile(savedReportPath, 'utf8');
    expect(savedReport).toContain('Hermes self-evolving');
    expect(savedReport).toContain('DSPy');

    await session.type('Use the previous deep research');
    await waitForCursorAfterTypedText(session, 'Use the previous deep research');

    await exitInteractive(session);
  }, 90_000);

  it('runs the usage_v2 dashboard from the interactive TUI', async () => {
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
          usageV2: true,
        },
      },
    });

    await waitForComposer(session);
    await session.type('/usage');
    await session.press('enter');
    await session.waitForText('Context window:', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Model:');
    expect(output).toContain('gpt-5.5');
    expect(output).toContain('Provider:');
    expect(output).toContain('openai');
    expect(output).toContain('Context window:');
    expect(output).toContain('Provider limits:');

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

  it('selects the Sandy theme and renders the expected Sandy colors', async () => {
    const session = await launchInteractive({
      env: {
        NO_COLOR: undefined,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      },
    });

    await waitForComposer(session);
    await session.type('/theme');
    await session.press('enter');
    await session.waitForText('Select a theme:', { timeout: 10_000 });
    await session.press('8');
    await session.waitForText("Theme changed to 'sandy'", { timeout: 10_000 });
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

  it('selects Ollama and applies the first listed model to the status line', async () => {
    const selectedModel = 'tuistory-first:latest';
    const ollamaServer = await createMockOllamaServer([selectedModel, 'tuistory-second:latest']);
    mockServers.push(ollamaServer);
    const session = await launchInteractive({
      config: {
        provider: 'openrouter',
        ollama: {
          baseUrl: ollamaServer.baseUrl,
          model: 'previous-ollama:latest',
        },
      },
    });

    await waitForComposer(session);
    await session.type('/model');
    await session.press('enter');
    await session.waitForText('Choose an LLM provider', { timeout: 10_000 });
    await session.press('7');
    await session.waitForText('Select a model', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText(`Using ollama model ${selectedModel}`, { timeout: 10_000 });
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`autohand (Ollama, ${selectedModel})`),
    });

    const screen = await session.text({ trimEnd: true });
    expect(screen).toContain(`autohand (Ollama, ${selectedModel})`);

    await exitInteractive(session);
  });
});
