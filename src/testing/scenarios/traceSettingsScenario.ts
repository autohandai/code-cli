/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

async function waitForScreen(session: Session, expected: string): Promise<string> {
  return session.text({ timeout: 20_000, waitFor: text => text.includes(expected) });
}

export async function inspectTraceSettings(session: Session): Promise<string> {
  await waitForScreen(session, '❯');
  await session.type('/settings');
  await waitForScreen(session, '/settings');
  await session.press('enter');
  await waitForScreen(session, 'Select a category:');
  await waitForScreen(session, '7. Agent Traces & Work Map');
  await session.press('7');
  const screen = await waitForScreen(session, 'Select a setting to change:');
  await session.press('escape');
  await waitForScreen(session, 'Select a category:');
  await session.press('escape');
  await waitForScreen(session, '❯');
  return screen;
}
