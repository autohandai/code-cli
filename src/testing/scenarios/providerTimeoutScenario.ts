import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export async function inspectProviderTimeout(session: Session): Promise<string> {
  const waitFor = (text: string) => waitForTerminalScreen(session, { timeout: 15_000, waitFor: screen => screen.includes(text) });
  await waitFor('❯');
  await session.type('/status');
  await session.press('enter');
  await waitFor('Esc to exit');
  await session.press('tab');
  const screen = await waitFor('provider default (300 s Autohand, 600 s Anthropic)');
  await session.press('escape');
  await waitFor('❯');
  return screen;
}
