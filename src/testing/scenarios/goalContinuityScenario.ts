import type { Session } from 'tuistory';

export async function inspectRecoveredCheckpointAndRefuseStaleResume(session: Session, inspectPaused: () => Promise<void>): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await inspectPaused();
  await session.type('/goal resume');
  await session.press('enter');
  await session.waitForText('Cannot resume', { timeout: 10_000 });
  await inspectPaused();
}

export async function pauseGoalWithFixtureSkill(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('/goal Use $continuity-checks to verify the approved saved artifact');
  await session.press('enter');
  await session.waitForText('GOAL_PAUSED_WITH_PIN', { timeout: 20_000 });
}

export async function resumeGoalWithPinnedSkill(session: Session, inspectPaused?: () => Promise<void>): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await inspectPaused?.();
  await session.type('/goal resume');
  await session.press('enter');
  await session.waitForText('GOAL_RESUMED_WITH_PIN', { timeout: 20_000 });
}
