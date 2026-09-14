/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, expect } from 'vitest';
import type { Session } from 'tuistory';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import {
  createTempAutohandHome,
  launchBuiltAutohand,
  type CreateTempAutohandHomeOptions,
  type MockAuthServer,
  type MockOllamaServer,
  type TuistoryTempState,
} from './autohandTuistory.js';

export const sessions: Session[] = [];
export const tempStates: TuistoryTempState[] = [];
export const mockAuthServers: MockAuthServer[] = [];
export const mockServers: MockOllamaServer[] = [];
export const mockOpenRouterFetchPreloads: Array<{ cleanup: () => Promise<void> }> = [];
export const mockResearchEvidenceServers: Array<{ close: () => Promise<void> }> = [];
export const CURSOR_CHAR = '█';
export const MODAL_NUMERIC_SHORTCUTS = new Set<string>([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]);

export type ModalNumericShortcut = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export function latestStableRepositoryVersion(): string {
  const tags = execFileSync('git', ['tag', '--merged', 'HEAD', '--list', '--sort=-version:refname'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
  }).split(/\r?\n/u);
  const tag = tags.find((candidate) => /^v\d+\.\d+\.\d+$/u.test(candidate));

  if (!tag) {
    throw new Error('Expected the test checkout to have a stable semantic-version tag');
  }
  return tag.slice(1);
}

/**
 * A selectable modal row: optional cursor, then its 1-9 shortcut. Section
 * headings share a list with the options but carry neither, so matching on this
 * is what separates a real option from the heading above it.
 */
export const MODAL_OPTION_ROW = /^\s*(?:▸\s*)?([1-9])\.\s/u;

export function isModalNumericShortcut(value: string | undefined): value is ModalNumericShortcut {
  return value !== undefined && MODAL_NUMERIC_SHORTCUTS.has(value);
}

export async function selectModalOptionByLabel(session: Session, label: string): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    const screen = await session.text({ trimEnd: true });
    const selectedLine = screen
      .split('\n')
      .find((line) => line.includes('▸') && line.includes(label));
    if (selectedLine) {
      await session.press('enter');
      return;
    }
    await session.press('down');
  }
  throw new Error(`Could not select modal option: ${label}`);
}

export async function trackSession(sessionPromise: Promise<Session>): Promise<Session> {
  const session = await sessionPromise;
  sessions.push(session);
  return session;
}

export async function typeLikeUser(session: Session, text: string): Promise<void> {
  for (const char of text) {
    await session.type(char);
  }
}

export function expectCursorAfterTypedText(screen: string, typedText: string): void {
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

export const CURSOR_POSITION_QUERY = '\x1b[6n';

// The click travels PTY -> CLI stdin -> Ink handler -> stdout -> PTY before the
// query can appear in the captured output, so poll instead of asserting at once.
export async function waitForCursorPositionQuery(session: Session, outputStart = 0): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!session.getRawOutput().slice(outputStart).includes(CURSOR_POSITION_QUERY)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the cursor position query after a click. Raw output tail:\n${JSON.stringify(session.getRawOutput().slice(-2_000))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function composerLineIncludes(screen: string, text: string): boolean {
  return screen.split('\n').some((line) => line.includes('❯') && line.includes(text));
}

export async function waitForCursorAfterTypedText(session: Session, typedText: string): Promise<string> {
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

export async function waitForTerminalCursorVisible(session: Session): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if (session.getTerminalData().cursorVisible) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(
    session.getTerminalData().cursorVisible,
    JSON.stringify(session.getRawOutput().slice(-2_000)),
  ).toBe(true);
}

export function linesContaining(screen: string, text: string): string[] {
  return screen.split('\n').filter((line) => line.includes(text));
}

export async function sampleImmediateScreens(
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

export function expectStableSingleComposerFrames(screens: string[]): void {
  expect(screens.length).toBeGreaterThan(0);

  for (const screen of screens) {
    expect(linesContaining(screen, '❯'), screen).toHaveLength(1);
    expect(screen, screen).not.toContain('[memory] turn reflection');
  }
}

export async function createMockResearchEvidenceServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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


/** Close every session, server, preload, and temp home a built-CLI test registered. */
export function registerBuiltCliCleanup(): void {
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
}

export async function launchInteractive(options: {
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

export async function waitForComposer(session: Session): Promise<void> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
}

/** The nearest line above the composer prompt that is more than its border. */
export function rowAboveComposer(screen: string): string {
  const lines = stripAnsi(screen).split('\n');
  const composerIndex = lines.findIndex((line) => line.includes('❯'));
  if (composerIndex <= 0) return '';
  return lines
    .slice(0, composerIndex)
    .reverse()
    .find((line) => line.replace(/[▔▁─\s]/gu, '').length > 0) ?? '';
}

export function idleTipOf(screen: string): string | undefined {
  return rowAboveComposer(screen).match(/ Tip: (.+?)\s*$/u)?.[1];
}

export const cachedAnnouncements = [
  {
    id: 'tuistory-announcement-one',
    title: 'Voice dictation is here',
    description: null,
    priority: 100,
    steps: [{
      id: 'tuistory-step-one',
      order: 0,
      type: 'image',
      mediaUrl: 'https://example.test/ignored.png',
      posterUrl: null,
      title: null,
      description: 'Keep your draft while dismissing this announcement.',
      ctaLabel: 'Read docs',
      ctaUrl: 'https://example.test/voice',
    }],
  },
  {
    id: 'tuistory-announcement-two',
    title: 'Squad mode is ready',
    description: null,
    priority: 50,
    steps: [{
      id: 'tuistory-step-two',
      order: 0,
      type: 'image',
      mediaUrl: 'https://example.test/ignored.png',
      posterUrl: null,
      title: null,
      description: 'Run /team to start.',
      ctaLabel: null,
      ctaUrl: null,
    }],
  },
];

export async function launchWithCachedAnnouncements(): Promise<Session> {
  const state = await createTempAutohandHome();
  tempStates.push(state);
  await writeFile(
    path.join(state.autohandHome, 'announcements.json'),
    JSON.stringify({ announcements: cachedAnnouncements, dismissedIds: [] }, null, 2),
  );
  return trackSession(launchBuiltAutohand([
    '--path',
    state.workspaceRoot,
    '--config',
    state.configPath,
    '--offline',
  ], {
    autohandHome: state.autohandHome,
    cwd: state.workspaceRoot,
    waitForDataTimeout: 15_000,
  }));
}
