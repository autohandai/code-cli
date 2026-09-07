/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Session } from 'tuistory';
import type { PtyDriver } from '../drivers/pty-driver.js';

export async function runTypedMessageHistoryPtyScenario(terminal: PtyDriver): Promise<void> {
  const press = async (action: () => void) => {
    action();
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  };
  await terminal.waitFor('SUBMITTED 0:');
  await press(() => terminal.type('first'));
  await press(() => terminal.enter());
  await terminal.waitFor('SUBMITTED 1: first');
  await press(() => terminal.type('second'));
  await press(() => terminal.enter());
  await terminal.waitFor('SUBMITTED 2: second');
  await press(() => terminal.up());
  await press(() => terminal.up());
  await press(() => terminal.type(' recalled'));
  await press(() => terminal.enter());
  await terminal.waitFor('SUBMITTED 3: first recalled');
  await press(() => terminal.type('unfinished'));
  await press(() => terminal.up());
  await press(() => terminal.down());
  await press(() => terminal.type(' restored'));
  await press(() => terminal.enter());
  await terminal.waitFor('SUBMITTED 4: unfinished restored');
  await press(() => terminal.ctrlC());
  await terminal.waitFor('Press Ctrl+C');
  await press(() => terminal.ctrlC());
  await terminal.waitFor('HISTORY_PTY_EXIT');
}

export async function readTypedMessageComposer(session: Session, expected: string): Promise<string> {
  const text = await session.text({
    timeout: 10_000,
    waitFor: text => text.slice(text.lastIndexOf('❯') + 1).split('\n')[0].trim() === expected,
  });
  return text.slice(text.lastIndexOf('❯') + 1).split('\n')[0].trim();
}

export async function seedTypedMessageHistory(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('First typed message');
  await session.press('enter');
  await session.waitForText('HISTORY_FIRST_DONE', { timeout: 20_000 });
  await session.type('Second typed message');
  await session.press('enter');
  await session.waitForText('HISTORY_SECOND_DONE', { timeout: 20_000 });
}

export async function recallTypedMessagesAcrossDirectories(session: Session): Promise<string[]> {
  await session.waitForText('❯');
  const snapshots: string[] = [];
  await session.type('Unfinished draft');
  await session.press('up');
  snapshots.push(await readTypedMessageComposer(session, 'Second typed message'));
  await session.press('up');
  snapshots.push(await readTypedMessageComposer(session, 'First typed message'));
  await session.press('down');
  snapshots.push(await readTypedMessageComposer(session, 'Second typed message'));
  await session.press('down');
  snapshots.push(await readTypedMessageComposer(session, 'Unfinished draft'));
  await session.press(['ctrl', 'c']);
  await session.type('/whatityped');
  await session.press('enter');
  await session.waitForText('What I typed · all directories');
  await session.press('down');
  await session.press('enter');
  snapshots.push(await readTypedMessageComposer(session, 'First typed message'));
  await session.type(' edited');
  await session.press('enter');
  await session.waitForText('HISTORY_EDIT_DONE', { timeout: 20_000 });
  await session.type('/whatityped');
  await session.press('enter');
  await session.waitForText('What I typed · all directories');
  await session.press('escape');
  await readTypedMessageComposer(session, 'Plan, search, build anything');
  return snapshots;
}
