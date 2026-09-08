import type { Session } from 'tuistory';

export async function requestCompletedWorkSummary(session: Session, expectedContent: string): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read package.json once and summarize the completed verification.');
  await session.press('enter');
  return await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes(expectedContent),
  });
}
