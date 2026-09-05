import type { Session } from 'tuistory';

export async function runConsoleConnectorsScenario(
  session: Session,
  deleteConnector: () => void,
  waitForDeletion: () => Promise<void>,
): Promise<void> {
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯') });
  await session.type('/mcp list');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Console-Search') });
  deleteConnector();
  await session.type('/sync');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Sync Status') });
  await session.press('s');
  await waitForDeletion();
  await session.press('escape');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯') });
  await session.type('/mcp list');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('No tools available') });
}
