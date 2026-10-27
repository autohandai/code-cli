/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Session, type LaunchOptions } from 'tuistory';

interface TerminalLaunchOptions extends LaunchOptions {
  waitForData?: boolean;
  waitForDataTimeout?: number;
}

export async function launchPipedTuistorySession(producer: string[], options: TerminalLaunchOptions): Promise<Session> {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return launchTuistorySession({
    ...options,
    command: '/bin/sh',
    args: ['-c', `${producer.map(quote).join(' ')} | ${[options.command, ...(options.args ?? [])].map(quote).join(' ')}`],
  });
}

export async function launchTuistorySession(options: TerminalLaunchOptions): Promise<Session> {
  const session = new Session(options);
  try {
    if (options.waitForData !== false) {
      await session.waitForData({ timeout: options.waitForDataTimeout ?? 5_000 });
      await session.waitIdle();
    }
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

export async function waitForExit(session: Pick<Session, 'exitInfo' | 'text'>, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!session.exitInfo) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for process exit. Current screen:\n' + await session.text({ immediate: true }));
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
}

export function expectCleanExit(session: Pick<Session, 'exitInfo'>): void {
  if (!session.exitInfo) {
    throw new Error('Expected process to have exited, but it is still running.');
  }
  if (session.exitInfo.exitCode !== 0) {
    throw new Error('Expected clean exit, got exitCode=' + session.exitInfo.exitCode + ' signal=' + session.exitInfo.signal);
  }
}

export async function exitInteractive(session: Pick<Session, 'exitInfo' | 'text' | 'press' | 'getRawOutput'>): Promise<void> {
  const outputOffset = session.getRawOutput().length;
  const teardownMarker = 'Ending Autohand session';
  const isEnding = (screen: string) => screen.includes(teardownMarker) || screen.includes('Session saved')
    || session.getRawOutput().slice(outputOffset).includes(teardownMarker);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (session.exitInfo) {
      expectCleanExit(session);
      return;
    }
    const screen = await waitForTerminalScreen(session, {
      timeout: 10_000,
      waitFor: text => Boolean(session.exitInfo) || isEnding(text)
        || text.includes('Press Ctrl+C again to exit') || /^\s*❯(?:\s|$)/mu.test(text),
    });
    if (session.exitInfo) {
      expectCleanExit(session);
      return;
    }
    // Redraws can clear the visible teardown marker after Ink has released raw mode.
    if (isEnding(screen)) {
      await waitForExit(session);
      expectCleanExit(session);
      return;
    }
    const confirmingExit = screen.includes('Press Ctrl+C again to exit');
    await session.press(['ctrl', 'c']);
    if (confirmingExit) {
      await waitForExit(session);
      expectCleanExit(session);
      return;
    }
    try {
      await waitForExit(session, 1_000);
    } catch {
      continue;
    }
    expectCleanExit(session);
    return;
  }
  await waitForExit(session);
  expectCleanExit(session);
}

interface TerminalScreenOptions {
  timeout: number;
  waitFor: (screen: string) => boolean;
  trimEnd?: boolean;
}

export async function waitForTerminalScreen(
  session: Pick<Session, 'text'>,
  options: TerminalScreenOptions,
): Promise<string> {
  const deadline = Date.now() + options.timeout;
  let screen = '';
  while (Date.now() < deadline) {
    screen = await session.text({ ...options, timeout: deadline - Date.now() });
    // Tuistory returns a later settled frame than the one its predicate checked.
    if (options.waitFor(screen)) return screen;
  }
  throw new Error(`Terminal did not retain the expected screen within ${options.timeout}ms:\n${screen}`);
}
