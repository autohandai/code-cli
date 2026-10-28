import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export async function startQueuedSteeringTurn(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read package.json and summarize the repository facts.');
  await session.press('enter');
  await session.waitForText('esc to cancel', { timeout: 10_000 });
}

export async function steerPendingMessage(
  session: Pick<Session, 'text' | 'type' | 'press' | 'writeRaw' | 'currentRows'>,
  options: { sequence: string; selected: boolean; fullScreen?: boolean },
): Promise<string> {
  const row = (screen: string) => screen.split('\n').slice(-session.currentRows)
    .map(line => line.trimStart().startsWith('❯')).lastIndexOf(true);
  const initial = options.fullScreen ? await waitForTerminalScreen(session, {
    timeout: 10_000,
    waitFor: screen => row(screen) >= session.currentRows - 7 && row(screen) < session.currentRows,
  }) : '';
  const baseline = row(initial);
  const waitForState = (predicate: (screen: string) => boolean, timeout = 10_000) => waitForTerminalScreen(session, {
    timeout,
    waitFor: screen => predicate(screen) && (!options.fullScreen || row(screen) === baseline),
  });
  const messages = options.selected
    ? ['QUEUE_LATER: leave this for the following turn', 'STEER_NOW: mention the worktrees too']
    : ['STEER_NOW: mention the worktrees too', 'QUEUE_LATER: leave this for the following turn'];
  for (let index = 0; index < messages.length; index++) {
    await session.type(messages[index]);
    await session.press('enter');
    await waitForState(screen => screen.includes('Queue · ' + (index + 1) + ' pending'));
  }
  if (options.selected) {
    await session.press('down'); await session.press('down');
    await waitForState(screen => screen.includes('› 2. STEER_NOW'), 5_000);
  } else {
    await session.type('KEEP_THIS_DRAFT');
  }
  session.writeRaw(options.sequence);
  return waitForState(text => text.includes('Queue · 1 pending') && text.includes('QUEUE_LATER')
    && (options.selected || text.includes('❯ KEEP_THIS_DRAFT')));
}

export function pendingQueueSnapshot(screen: string): string[] {
  const lines = screen.split('\n').map(line => line.trim());
  const index = lines.findIndex(line => line.startsWith('Queue ·'));
  if (index < 0) throw new Error('Expected the pending queue to remain visible');
  return lines.slice(index, index + 2);
}

export async function requestGitStatus(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Run git status to confirm everything is clean');
  await session.press('enter');
}
