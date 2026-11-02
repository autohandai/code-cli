import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export async function typeWhileMcpStarts(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 5_000 });
  await session.type('Keep this startup draft');
  return waitForTerminalScreen(session, {
    timeout: 3_000,
    waitFor: screen => screen.split('\n').slice(-session.currentRows)
      .some(line => line.trimStart().startsWith('❯ Keep this startup draft')),
  });
}

export async function runMcpStartupFailureScenario(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/mcp connect github');
  await session.press('enter');
  return session.text({ timeout: 15_000, waitFor: text => text.includes('GitHub MCP image pull was denied') });
}
