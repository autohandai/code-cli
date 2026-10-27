/** @license Apache-2.0 */
import type { Session } from 'tuistory';

export async function requestComputerUseTrust(session: Session, request: string): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type(request);
  await session.press('enter');
  await session.waitForText('Trust Autohand Computer Use?', { timeout: 15_000 });
  await session.waitForText('Trust and set up', { timeout: 15_000 });
  return session.text({ immediate: true });
}

export async function answerComputerUseTrust(session: Session, trust: boolean): Promise<void> {
  if (trust) await session.press('up');
  await session.press('enter');
}
