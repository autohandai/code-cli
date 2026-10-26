import type { Session } from 'tuistory';

export async function inspectFreeSearchAllowance(session: Session, remaining: number): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/search');
  await session.press('enter');
  await session.waitForText(`${remaining} of 10 free searches left today`, { timeout: 15_000 });
  await session.waitForText('Resets at 00:00 UTC.');
  await session.waitForText('Select search provider:');
  await session.waitForText('Autohand');
  await session.press('escape');
  await session.waitForText('Search configuration cancelled.');
  await session.waitForText('❯');
}
