/** @license Apache-2.0 */
import path from 'node:path';
import type { Session as TerminalSession } from 'tuistory';
import { mkdir, writeFile } from 'node:fs/promises';
import { Session } from '../../session/SessionManager.js';
import type { PtyDriver } from '../drivers/pty-driver.js';
import { outputViewport } from './compactOutputScenario.js';

export async function startFullScreenHeaderProbe(session: TerminalSession): Promise<void> {
  await session.type('Say hello');
  await session.waitForText('❯ Say hello');
  await session.press('enter');
  await session.waitForText('esc to cancel', { timeout: 10_000 });
}

export async function seedFullScreenHistory(home: string, project: string): Promise<void> {
  const date = new Date().toISOString();
  const metadata = { sessionId: 'full-screen-history', createdAt: date, lastActiveAt: date, projectPath: project,
    projectName: 'workspace', model: 'moa', messageCount: 80, status: 'completed' as const };
  await mkdir(path.join(home, 'sessions', metadata.sessionId), { recursive: true });
  const session = new Session(path.join(home, 'sessions', metadata.sessionId), metadata);
  for (let index = 0; index < 80; index++) await session.appendTransient({ role: 'assistant', content: `History item ${index} — preserved transcript`, timestamp: date });
  await session.save();
  await writeFile(path.join(home, 'sessions', metadata.sessionId, 'metadata.json'), JSON.stringify(metadata));
  await writeFile(path.join(home, 'sessions', 'index.json'), JSON.stringify({ sessions: [{ id: metadata.sessionId, projectPath: project, createdAt: date }], byProject: { [project]: [metadata.sessionId] } }));
}

export async function clickFullScreenComposer(session: TerminalSession, column: number, row: number): Promise<void> {
  await session.clickAt(column, row);
  const [cursorColumn, cursorRow] = session.getTerminalData().cursor;
  session.writeRaw(`\x1b[${cursorRow + 1};${cursorColumn + 1}R`);
  await session.waitIdle();
}

export async function typeMultilineDraft(session: TerminalSession, lines: readonly string[]): Promise<void> {
  for (let index = 0; index < lines.length; index++) {
    await session.type(lines[index]!);
    if (index < lines.length - 1) {
      session.writeRaw('\n');
      await session.waitIdle();
    }
  }
}

export async function runFullScreenLiveOutputScenario(session: TerminalSession) {
  await session.waitForText('live-row-60');
  const highlightedBefore = await session.text({ only: { background: '#44475a' }, trimEnd: true });
  await session.type('preserved draft');
  await session.waitForText('❯ preserved draft');
  await session.press('pageup');
  await session.waitForText('Back to bottom');
  await session.press(['ctrl', 'o']);
  await session.waitForText('Ctrl+O collapse');
  const expanded = outputViewport(session);
  await session.press('pagedown');
  await session.text();
  const paged = outputViewport(session);
  session.resize({ cols: 48, rows: 24 });
  await session.text();
  const resized = outputViewport(session);
  await session.press(['ctrl', 'o']);
  await session.waitForText('Ctrl+O expand');
  await session.waitForText('live-row-60');
  const collapsed = outputViewport(session);
  await session.press(['ctrl', 'f']);
  await session.type('thanks');
  await session.press('enter');
  await session.press('esc');
  await session.waitForText('❯ thanks');
  const highlightedAfter = await session.text({ only: { background: '#44475a' }, trimEnd: true });
  return { expanded, paged, resized, collapsed, highlightedBefore, highlightedAfter };
}

export async function runFullScreenLiveOutputPtyScenario(terminal: PtyDriver): Promise<void> {
  await terminal.waitFor('live-row-60');
  terminal.type('preserved draft');
  await terminal.waitFor('❯ preserved draft');
  let after = terminal.snapshot().length;
  terminal.type('\x1b[5~');
  await terminal.waitFor('Back to bottom', 10_000, after);
  after = terminal.snapshot().length;
  terminal.type('\x0f');
  await terminal.waitFor('Ctrl+O collapse', 10_000, after);
  await terminal.waitFor(/live-row-1\r?\n/u, 10_000, after);
  after = terminal.snapshot().length;
  terminal.type('\x0f');
  await terminal.waitFor('Ctrl+O expand', 10_000, after);
  after = terminal.snapshot().length;
  terminal.ctrlC();
  await terminal.waitFor('Plan, search, build anything', 10_000, after);
  terminal.ctrlC();
  await terminal.waitFor('Press Ctrl+C again to exit');
  terminal.ctrlC();
  await terminal.waitFor('FULL_SCREEN_PTY_EXIT');
}
