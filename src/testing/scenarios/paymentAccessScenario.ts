import type { Session } from 'tuistory';

export async function sendPaymentTransitionTurn(session: Session, prompt: string, response: string) {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type(prompt);
  await session.press('enter');
  await session.waitForText(response, { timeout: 30_000 });
}
