import type { Session } from 'tuistory';

export async function startQueuedSteeringTurn(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read package.json and summarize the repository facts.');
  await session.press('enter');
  await session.waitForText('esc to cancel', { timeout: 10_000 });
}

export async function steerPendingMessage(
  session: Session,
  options: { sequence: string; selected: boolean; fullScreen?: boolean },
): Promise<string> {
  const row = () => session.getTerminalData().lines
    .slice(-session.currentRows)
    .map(line => line.spans.map(span => span.text).join('').trimStart().startsWith('❯'))
    .lastIndexOf(true);
  await session.waitIdle();
  const baseline = row();
  const checkAnchor = async () => {
    await session.waitIdle();
    if (options.fullScreen && (baseline < 0 || row() !== baseline)) throw new Error(`Composer moved from row ${baseline} to ${row()}`);
  };
  const messages = options.selected
    ? ['QUEUE_LATER: leave this for the following turn', 'STEER_NOW: mention the worktrees too']
    : ['STEER_NOW: mention the worktrees too', 'QUEUE_LATER: leave this for the following turn'];
  for (let index = 0; index < messages.length; index++) {
    await session.type(messages[index]);
    await session.press('enter');
    await session.waitForText('Queue · ' + (index + 1) + ' pending', { timeout: 10_000 });
    await checkAnchor();
  }
  if (options.selected) {
    await session.press('down'); await session.press('down');
    await session.waitForText('› 2. STEER_NOW', { timeout: 5_000 });
    await checkAnchor();
  } else {
    await session.type('KEEP_THIS_DRAFT');
  }
  session.writeRaw(options.sequence);
  const screen = await session.text({
    timeout: 10_000,
    waitFor: text => text.includes('Queue · 1 pending') && text.includes('QUEUE_LATER')
      && (options.selected || text.includes('❯ KEEP_THIS_DRAFT')),
  });
  await checkAnchor();
  return screen;
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
