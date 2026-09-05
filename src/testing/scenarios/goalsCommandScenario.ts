/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function openGoalsPanel(session: Session): Promise<void> {
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯') });
  await session.type('/goals');
  await session.waitForText('Open the live goals queue', { timeout: 5_000 });
  await session.press('enter');
  await session.waitForText('Goals ·', { timeout: 5_000 });
}
