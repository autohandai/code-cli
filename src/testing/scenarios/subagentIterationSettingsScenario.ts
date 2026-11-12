import type { Session } from 'tuistory';

export async function configureSubagentIterationLimit(session: Session, limit: number): Promise<string> {
  await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
  const invalid = '/settings agent.subagentMaxIterations 0';
  await session.type(invalid);
  await session.text({ timeout: 20_000, waitFor: text => text.includes(invalid) });
  await session.press('enter');
  const validation = await session.text({ timeout: 20_000, waitFor: text => text.includes('Sub-agent iteration limit must be an integer between 1 and 1000') });
  const valid = `/settings agent.subagentMaxIterations ${limit}`;
  await session.type(valid);
  await session.text({ timeout: 20_000, waitFor: text => text.includes(valid) });
  await session.press('enter');
  await session.text({ timeout: 20_000, waitFor: text => text.includes(`Set agent.subagentMaxIterations = ${limit}`) });
  return validation;
}
