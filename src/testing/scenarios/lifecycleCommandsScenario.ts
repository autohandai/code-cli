/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function submitLifecycleCommand(session: Session, command: string, expected: string): Promise<void> {
  await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
  await session.type(command);
  await session.text({ timeout: 10_000, waitFor: text => text.includes(command) });
  await session.press('enter');
  await session.waitForText(expected, { timeout: 20_000 });
}

export async function inspectLifecycleHelp(session: Session): Promise<string> {
  await submitLifecycleCommand(session, '/pr-review help', 'Review is read-only');
  await submitLifecycleCommand(session, '/deslop help', 'Preserves behavior and unrelated work');
  await submitLifecycleCommand(session, '/tester help', 'Capture is not visual inspection');
  return session.readAll();
}
