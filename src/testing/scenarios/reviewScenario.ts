import type { Session } from 'tuistory';

export async function runInteractiveSecurityReview(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('/review security src --audience forensic');
  await session.press('enter');
  await session.waitForText('REVIEW_TUI_COMPLETE', { timeout: 30_000 });
}

export async function observeNonInteractiveSecurityReview(session: Session): Promise<void> {
  await session.waitForText('REVIEW_CLI_COMPLETE', { timeout: 30_000 });
}
