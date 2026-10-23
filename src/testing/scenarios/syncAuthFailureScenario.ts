/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function runSyncAuthFailureScenario(
  session: Session,
  rejectSyncAuthentication: () => void,
  exitKey: 'escape' | readonly ['ctrl', 'c'],
): Promise<void> {
  await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
  await session.type('/sync');
  await session.press('tab');
  await session.press('enter');
  await session.waitForText('Sync Status', { timeout: 10_000 });
  rejectSyncAuthentication();
  await session.press('s');
  await session.waitForText('Authentication expired. Please run /login again.', { timeout: 10_000 });
  await new Promise<void>(resolve => setTimeout(resolve, 3_000));
  await session.press(typeof exitKey === 'string' ? exitKey : [...exitKey]);
  await session.text({ timeout: 5_000, waitFor: text => text.includes('❯') && !text.includes('Settings Sync:') });
  await session.type('verify sync recovery');
  await session.text({ timeout: 5_000, waitFor: text => text.split('\n').some(line => line.includes('❯') && line.includes('verify sync recovery')) });
}
