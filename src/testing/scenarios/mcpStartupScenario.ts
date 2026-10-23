import type { Session } from 'tuistory';

export async function runMcpStartupFailureScenario(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/mcp connect github');
  await session.press('enter');
  return session.text({ timeout: 15_000, waitFor: text => text.includes('GitHub MCP image pull was denied') });
}
