import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export async function typeBeforeSearchCapabilityCheck(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 10_000 });
  await session.type('Keep this search startup draft');
  return waitForTerminalScreen(session, {
    timeout: 3_000,
    waitFor: screen => screen.split('\n').slice(-session.currentRows)
      .some(line => line.trimStart().startsWith('❯ Keep this search startup draft')),
  });
}
