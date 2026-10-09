import type { Session } from 'tuistory';

export async function requestScopedCommand(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('Run the requested shell command');
  await session.press('enter');
}

export async function approveExpiredYoloCommand(session: Session): Promise<void> {
  await session.waitForText('Run this shell command', { timeout: 15_000 });
  await session.press('enter');
  await session.waitForText('SCOPE_TURN_FINISHED', { timeout: 15_000 });
}
