import type { Session } from 'tuistory';

export async function showDocumentFactoryInstruction(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/factory trd checkout');
  await session.press('enter');
  await session.waitForText('Technical Requirements Document (TRD)', { timeout: 10_000 });
  await session.waitForText('docs/trd.md', { timeout: 10_000 });
}
