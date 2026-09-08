/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

async function waitForScreen(session: Session, expected: string): Promise<void> {
  await session.text({ timeout: 20_000, waitFor: text => text.includes(expected) });
}

export async function selectMaximumMoaReasoning(session: Session): Promise<string> {
  await waitForScreen(session, '❯');
  await session.type('/model');
  await waitForScreen(session, '/model');
  await session.press('enter');
  await waitForScreen(session, 'What would you like to change?');
  await session.press('1');
  await waitForScreen(session, 'Change API key only');
  await session.press('1');
  await waitForScreen(session, 'Select a model');
  await session.press('enter');
  await waitForScreen(session, 'Choose Moa thinking effort');
  await session.press('3');
  await waitForScreen(session, 'Autohand AI settings updated successfully!');
  await waitForScreen(session, '❯');
  return session.readAll();
}
