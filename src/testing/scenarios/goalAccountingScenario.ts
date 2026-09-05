/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function runGoalAccountingScenario(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('/goal first accounting goal');
  await session.press('enter');
  await session.waitForText('ACCOUNTING_FIRST_TURN', { timeout: 15_000 });
  await session.type('/goal second accounting goal');
  await session.press('enter');
  await session.waitForText('Queued goal.', { timeout: 10_000 });
  await session.type('Finish the first accounting goal now.');
  await session.press('enter');
  await session.waitForText('ACCOUNTING_COMPLETION_TURN', { timeout: 15_000 });
}
