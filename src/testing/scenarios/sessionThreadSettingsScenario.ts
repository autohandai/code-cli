/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

async function waitForScreen(session: Session, expected: string): Promise<string> {
  return session.text({ timeout: 20_000, waitFor: text => text.includes(expected) });
}

export async function configureSessionThreadLimit(session: Session): Promise<string> {
  await waitForScreen(session, '❯');
  await session.type('/settings');
  await waitForScreen(session, '/settings');
  await session.press('enter');
  await waitForScreen(session, 'Select a category:');
  await session.press('8');
  await waitForScreen(session, 'Session thread limit (main agent included)');
  await session.press('1');
  await waitForScreen(session, 'Enter to submit');
  await session.press('backspace');
  await session.type('0');
  await session.press('enter');
  const validationScreen = await waitForScreen(session, 'integer between 1 and 64');
  await session.press('backspace');
  await session.type('4');
  await session.press('enter');
  await waitForScreen(session, 'Session thread limit (main agent included): 4');
  await session.press('escape');
  await waitForScreen(session, 'Select a category:');
  await session.press('escape');
  await waitForScreen(session, '❯');
  return validationScreen;
}

export async function setSessionThreadLimitDirectly(session: Session, limit: number): Promise<void> {
  const command = `/settings features.multi_agent_v2.max_concurrent_threads_per_session ${limit}`;
  await session.type(command);
  await waitForScreen(session, command);
  await session.press('enter');
  await waitForScreen(session, `Set features.multi_agent_v2.max_concurrent_threads_per_session = ${limit}`);
}
