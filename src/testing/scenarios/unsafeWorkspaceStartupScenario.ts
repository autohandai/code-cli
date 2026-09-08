import type { Session } from 'tuistory';

export async function readUnsafeWorkspaceStartup(session: Session): Promise<string> {
  await session.waitForText('Unsafe Workspace Directory');
  await session.waitForText('autohand --path');
  return session.readAll();
}
