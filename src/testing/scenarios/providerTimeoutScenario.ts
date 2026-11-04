import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export async function inspectProviderTimeout(session: Session, expected = 'provider default (120 s)'): Promise<string> {
  const waitFor = (text: string) => waitForTerminalScreen(session, { timeout: 15_000, waitFor: screen => screen.includes(text) });
  await waitFor('❯');
  await session.type('/status');
  await session.press('enter');
  await waitFor('Esc to exit');
  await session.press('tab');
  const screen = await waitFor(expected);
  await session.press('escape');
  await waitFor('❯');
  return screen;
}
