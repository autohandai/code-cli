import type { Session } from 'tuistory';

export async function waitForPeerComposer(session: Session): Promise<void> {
  await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
}

export async function selectPeerAndSend(session: Session, alias: string, content: string): Promise<string> {
  await waitForPeerComposer(session);
  await session.type(`:${alias}`);
  await session.text({ timeout: 20_000, waitFor: text => text.includes(`:${alias}`) && text.includes('Tab') });
  await session.press('enter');
  await session.type(content);
  await session.press('enter');
  return session.text({ timeout: 20_000, waitFor: text => text.includes('accepted') });
}

export async function openPeerInbox(session: Session): Promise<string> {
  await session.type('/peers inbox');
  await session.press('enter');
  return session.text({ timeout: 20_000, waitFor: text => text.includes('Peer inbox') });
}

export async function preserveDraftWhileClosingPeerPicker(session: Session): Promise<string> {
  await waitForPeerComposer(session);
  await session.type('Keep this draft :');
  await session.text({ timeout: 20_000, waitFor: text => text.includes('Tab') });
  await session.press('escape');
  return session.text({ timeout: 20_000, waitFor: text => text.includes('Keep this draft :') });
}
