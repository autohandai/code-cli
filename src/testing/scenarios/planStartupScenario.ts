import type { Session } from 'tuistory';

export async function startPlanFromComposer(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.waitForText('[PLAN]');
  const screen = await session.text({ immediate: true });
  const modeLine = screen.split('\n').find((line) => line.includes('[PLAN]'));
  if (!modeLine) throw new Error('The initial composer did not show plan mode.');
  await session.type('Plan a small refactor');
  await session.press('enter');
  await session.waitForText('PLAN_STARTUP_COMPLETE', { timeout: 20_000 });
  return modeLine.trim();
}

export async function leaveStartupPlanMode(session: Session): Promise<void> {
  await session.press(['shift', 'tab']);
  await session.waitForText('[YOLO]');
  await session.type('/plan on');
  await session.press('enter');
  await session.waitForText('[PLAN]');
}

export async function declineStartupPlan(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Plan a small refactor');
  await session.press('enter');
  await session.waitForText('Would you like to proceed?', { timeout: 20_000 });
  await session.press('escape');
  await session.waitForText('PLAN_STARTUP_COMPLETE', { timeout: 20_000 });
}
