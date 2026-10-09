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
