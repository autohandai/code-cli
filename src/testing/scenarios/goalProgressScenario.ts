/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function inspectStoppedGoal(session: Session, status: 'blocked' | 'waiting'): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('/goal finish checkpoint work');
  await session.press('enter');
  await session.waitForText('GOAL_STOPPED_FOR_APPROVAL', { timeout: 15_000 });
  await session.type('/goal');
  await session.press('enter');
  await session.waitForText(`Status: ${status}`, { timeout: 5000 });
  await session.waitForText('Checkpoint: Patch prepared', { timeout: 5000 });
}

export async function resumeStoppedGoal(session: Session): Promise<void> {
  await session.type('/goal resume');
  await session.press('enter');
  await session.waitForText('GOAL_RESUMED_AND_FINISHED', { timeout: 15_000 });
}
