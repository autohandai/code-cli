import type { Session } from 'tuistory';

export async function selectSquadAgentAndMessage(session: Session): Promise<string> {
  await session.type('/squad');
  await session.press('enter');
  await session.waitForText('Select a Squad agent', { timeout: 15000 });
  await session.type('Kai');
  await session.press('enter');
  await session.waitForText('Selected Squad agent Kai (kai)', { timeout: 10000 });
  await session.type('/message Review the CLI fixture');
  await session.press('enter');
  await session.waitForText('Receipt: receipt-1', { timeout: 10000 });
  await session.type('/squad history');
  await session.press('enter');
  return session.text({ timeout: 10000, waitFor: text => text.includes('SQUAD_DIRECT_REPLY') });
}

export async function invokeBuiltinSquadMcp(session: Session): Promise<string> {
  await session.type("Read Kai's saved Squad profile using the built-in MCP.");
  await session.press('enter');
  return session.text({ timeout: 20000, waitFor: text => text.includes('BUILTIN_SQUAD_MCP_VERIFIED') });
}
