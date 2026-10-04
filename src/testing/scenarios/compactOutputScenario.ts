import type { Session } from 'tuistory';

export const LONG_OUTPUT_COMMAND = { command: 'seq', args: ['-f', 'row-%g', '1', '40'] };
export const FIRST_HIDDEN_ROW = 'row-4';
export const LAST_ROW = 'row-40';
export const EXPAND_HINT = '+ 37 lines (ctrl+o to expand)';

/** Runs the scripted turn and returns the screen once the turn has finished. */
export async function runLongOutputTurn(session: Session, finishedMarker: string): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('List forty rows');
  await session.press('enter');
  await session.waitForText(finishedMarker, { timeout: 30_000 });
  return await session.text({ immediate: true, trimEnd: true });
}

export async function expandLatestOutput(session: Session): Promise<string> {
  await session.press(['ctrl', 'o']);
  return await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('Ctrl+O collapse') && text.includes(LAST_ROW),
    trimEnd: true,
  });
}

export async function collapseLatestOutput(session: Session): Promise<string> {
  await session.press(['ctrl', 'o']);
  return await session.text({
    timeout: 10_000,
    waitFor: (text) => !text.includes('Ctrl+O collapse'),
    trimEnd: true,
  });
}
