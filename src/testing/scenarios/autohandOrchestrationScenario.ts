import type { Session } from 'tuistory';

export async function runOrchestrationScenario(session: Session): Promise<string> {
  await session.text({ timeout: 30_000, waitFor: text => text.includes('Plan, search, build anything') });
  await session.type('Inspect fixture.txt using three independent research workers and summarize the findings.');
  await session.press('enter');
  return session.text({ timeout: 45_000, waitFor: text => text.includes('ORCHESTRATION_VERIFIED') });
}
