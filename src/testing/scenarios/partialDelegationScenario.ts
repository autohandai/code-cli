import type { Session } from 'tuistory';

export async function runPartialDelegationScenario(session: Session): Promise<string> {
  await session.text({ timeout: 30_000, waitFor: text => text.includes('Plan, search, build anything') });
  await session.type('Inspect code and docs with two readers, then summarize all available findings.');
  await session.press('enter');
  return session.text({ timeout: 30_000, waitFor: text => text.includes('SIBLING_REPORT_') });
}
