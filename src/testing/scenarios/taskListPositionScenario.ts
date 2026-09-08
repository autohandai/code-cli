/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

async function waitForScreen(session: Session, expected: string): Promise<void> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes(expected),
  });
}

export async function setTaskListPositionDirectly(
  session: Session,
  position: 'up' | 'above-composer' | 'above composer',
): Promise<void> {
  const command = `/settings task_list position ${position}`;
  const savedPosition = position === 'up' ? 'up' : 'above-composer';
  await waitForScreen(session, '❯');
  await session.type(command);
  await waitForScreen(session, command);
  await session.press('enter');
  await waitForScreen(session, `Task list position: ${savedPosition}`);
  await waitForScreen(session, '❯');
}

export async function setTaskListPositionUp(session: Session): Promise<void> {
  await waitForScreen(session, '❯');
  await session.type('/settings');
  await waitForScreen(session, '/settings');
  await session.press('enter');

  await waitForScreen(session, 'Select a category:');
  await session.press('1');
  await waitForScreen(session, 'Select a setting to change:');
  await session.press('5');
  await waitForScreen(session, 'Task list position');
  await session.press('1');
  await waitForScreen(session, 'Task list position: up');

  await session.press('escape');
  await waitForScreen(session, 'Select a category:');
  await session.press('escape');
  await waitForScreen(session, '❯');
}

export async function setTaskListPositionWithPicker(session: Session): Promise<void> {
  const command = '/settings task_list position';
  await waitForScreen(session, '❯');
  await session.type(command);
  await waitForScreen(session, command);
  await session.press('enter');
  await waitForScreen(session, 'Task list position');
  await session.press('1');
  await waitForScreen(session, 'Task list position: up');
  await waitForScreen(session, '❯');
}
