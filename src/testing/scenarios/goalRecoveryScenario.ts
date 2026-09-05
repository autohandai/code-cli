/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function openGoalRecovery(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('/goal recover');
  await session.press('enter');
  await session.waitForText('Recover an offline goal', { timeout: 5000 });
}

export async function cancelGoalRecovery(session: Session): Promise<void> {
  await session.press('escape');
  await session.waitForText('Recovery cancelled', { timeout: 5000 });
}

export async function selectOriginalGoal(session: Session): Promise<void> {
  await session.press('down');
  await session.press('up');
  await session.press('enter');
  await session.waitForText('Recovered session', { timeout: 10_000 });
  await session.waitForText('RECOVERED_CONVERSATION_MARKER', { timeout: 5000 });
  await session.type('Summarize the restored work without resuming the goal.');
  await session.press('enter');
  await session.waitForText('RECOVERY_CONTEXT_SEEN', { timeout: 15_000 });
}

export async function refuseLiveGoalRecovery(session: Session, ownerId: string): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type(`/goal recover ${ownerId}`);
  await session.press('enter');
  await session.waitForText('live session', { timeout: 5000 });
}

export async function finishRecoveredGoal(session: Session): Promise<void> {
  await session.type('/goal resume');
  await session.press('enter');
  await session.waitForText('RECOVERED_GOAL_FINISHED', { timeout: 15_000 });
}
