import type { Session } from 'tuistory';

const PLAN_MODE_LABEL = '● PLAN';

export async function startPlanFromComposer(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.waitForText(PLAN_MODE_LABEL);
  const screen = await session.text({ immediate: true });
  // The help-line label is the only mode indicator; a banner above the composer must not come back.
  if (/\[PLAN\]|Plan mode active/u.test(screen)) throw new Error('The composer printed a plan mode banner.');
  await session.type('Plan a small refactor');
  await session.press('enter');
  await session.waitForText('PLAN_STARTUP_COMPLETE', { timeout: 20_000 });
  return PLAN_MODE_LABEL;
}

export async function leaveStartupPlanMode(session: Session): Promise<void> {
  // Shift+Tab follows INTERACTION_MODE_SEQUENCE: plan advances to auto mode.
  await session.press(['shift', 'tab']);
  await session.waitForText('● AUTO');
  await session.type('/plan on');
  await session.press('enter');
  await session.waitForText(PLAN_MODE_LABEL);
}

export async function declineStartupPlan(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Plan a small refactor');
  await session.press('enter');
  await session.waitForText('Would you like to proceed?', { timeout: 20_000 });
  await session.press('escape');
  await session.waitForText('PLAN_STARTUP_COMPLETE', { timeout: 20_000 });
}
