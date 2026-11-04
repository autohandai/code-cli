import type { Session } from 'tuistory';

export async function runAdaptiveSkillsTurn(session: Session, prompt: string, completionMarker: string): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type(prompt);
  await session.press('enter');
  await session.waitForText(completionMarker, { timeout: 30_000 });
  return await session.text({ immediate: true, trimEnd: true });
}

export async function cancelAdaptiveSkillAuthoring(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/skills-new');
  await session.press('enter');
  await session.waitForText('Skill name', { timeout: 10_000 });
  await session.press('escape');
  await session.waitForText('Cancelled.', { timeout: 10_000 });
  await session.waitForText('❯', { timeout: 10_000 });
  await session.type('AUTHORING_CANCEL_DRAFT');
  await session.waitForText('❯ AUTHORING_CANCEL_DRAFT', { timeout: 10_000 });
}

export async function inspectAdaptiveSkillSettings(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/settings');
  await session.press('enter');
  await session.waitForText('Agent Behavior', { timeout: 10_000 });
  await session.press('down');
  await session.press('enter');
  await session.waitForText('Adaptive skills', { timeout: 10_000 });
  const screen = await session.text({ immediate: true, trimEnd: true });
  await session.press('escape');
  await session.waitForText('Agent Behavior', { timeout: 10_000 });
  await session.press('escape');
  await session.waitForText('❯', { timeout: 10_000 });
  await session.type('/settings skills.learning.enabled false');
  await session.press('enter');
  await session.waitForText('Set skills.learning.enabled = false', { timeout: 10_000 });
  return screen;
}
