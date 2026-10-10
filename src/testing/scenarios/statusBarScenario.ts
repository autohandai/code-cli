/** @license Apache-2.0 */
import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

async function waitFor(session: Session, text: string): Promise<string> {
  return waitForTerminalScreen(session, { timeout: 15_000, waitFor: screen => screen.includes(text) });
}

async function highlight(session: Session, label: string): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    const screen = await session.text({ trimEnd: true });
    if (screen.split('\n').some(line => line.includes('▸') && line.includes(label))) return;
    await session.press('down');
  }
  throw new Error(`Status-bar option is unavailable: ${label}`);
}

export async function configureTwoLineStatusBar(session: Session): Promise<string> {
  await waitFor(session, '❯');
  await session.type('/statusbar');
  await session.press('enter');
  await waitFor(session, 'Layout: classic');
  await session.press('1');
  await waitFor(session, 'Status Bar Layout');
  await session.press('down');
  await session.press('enter');
  await waitFor(session, 'Layout: two-line');
  await session.press('2');
  await waitFor(session, 'Toggle Status Bar Sections');
  await highlight(session, 'Project');
  await session.press('space');
  const toggled = await session.text({ trimEnd: true });
  await highlight(session, 'Done');
  await session.press('space');
  await session.press('enter');
  await waitFor(session, 'Layout: two-line');
  await session.press('escape');
  await waitFor(session, 'Status bar settings saved.');
  await waitFor(session, '❯');
  return toggled;
}

export async function inspectLegacyStatusLine(session: Session): Promise<string> {
  await session.type('/statusline');
  await session.press('enter');
  const screen = await waitFor(session, 'Cancel hint');
  await session.press('escape');
  await waitFor(session, '❯');
  return screen;
}
