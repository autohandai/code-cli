/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export function isTerminalMouseTrackingEnabled(session: Session): boolean {
  let enabled = false;
  for (const match of session.getRawOutput().matchAll(/\x1b\[\?1000([hl])/g)) {
    enabled = match[1] === 'h';
  }
  return enabled;
}

export async function releaseMouseForHistory(session: Session): Promise<void> {
  await session.scrollUp(1, 5, 3);
  if (isTerminalMouseTrackingEnabled(session)) {
    throw new Error('Mouse tracking still captures the wheel instead of allowing terminal history scrolling.');
  }
}

export async function openGoalWithHistory(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('/experiments enable slash_goals');
  await session.press('enter');
  await session.waitForText('Enabled slash_goal.');
  await session.type('/goal Investigate the terminal history');
  await session.press('enter');
  await session.waitForText('HISTORY_END', { timeout: 20_000 });
  await session.type('/goals');
  await session.press('enter');
  await session.waitForText('Goals · 1 total');
}

export async function readHistoryDuringGoalWork(session: Session): Promise<string> {
  await session.type('Continue investigating terminal history');
  await session.press('enter');
  await session.waitForText('HISTORY_BACKGROUND_ACTIVE', { timeout: 15_000 });
  await session.type('keep this draft');
  await releaseMouseForHistory(session);
  const outputStart = session.getRawOutput().length;
  await session.waitForText('HISTORY_BACKGROUND_FINAL', { timeout: 15_000 });
  await session.waitIdle();
  return session.getRawOutput().slice(outputStart);
}

export async function editComposerAfterReading(session: Session): Promise<string> {
  await session.type('hello');
  const data = session.getTerminalData();
  const viewport = data.lines.slice(-data.rows)
    .map((line) => line.spans.map((span) => span.text).join(''));
  const composerRow = viewport.findIndex((line) => line.includes('❯ keep this drafthello'));
  if (composerRow < 0) throw new Error('Expected the draft to be visible after keyboard editing resumed.');
  await session.clickAt(viewport[composerRow]!.indexOf('llo'), composerRow);
  const [column, row] = session.getTerminalData().cursor;
  session.writeRaw(`\x1b[${row + 1};${column + 1}R`);
  await session.waitIdle();
  await session.type('X');
  return session.text({ timeout: 5_000, waitFor: (text) => text.includes('heXllo') });
}
