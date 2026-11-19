/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../../session/ActiveAgentRegistry.js';
import { Session as SavedSession } from '../../session/SessionManager.js';

export interface ActiveAgentSessionsFixture {
  stop: () => void;
}

function fixtureRecord(index: number, name: string, startedAt: number): ActiveAgentRecord {
  return {
    version: 1,
    pid: process.pid,
    sessionId: `${name}-session-${index}`,
    workspaceRoot: `/fixture/${name}`,
    projectName: name,
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    mode: 'interactive',
    status: index % 2 === 0 ? 'working' : 'idle',
    startedAt: new Date(startedAt + index * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: index + 1,
    contextPercent: 10 * (index + 1),
    tokensUsed: 1_000 * (index + 1),
    activity: { phase: 'thinking', instruction: `Instruction for ${name}`, pathsWritten: [`src/${name}.ts`] },
  };
}

/**
 * Publishes heartbeats for several sessions and keeps refreshing them in a
 * rotating order, the way independent live sessions do, so the view under test
 * is re-sorted by the registry on every refresh.
 */
export async function publishActiveAgentSessions(autohandHome: string, names: string[]): Promise<ActiveAgentSessionsFixture> {
  const registry = new ActiveAgentRegistry(path.join(autohandHome, 'active-agents'));
  const startedAt = Date.now() - 600_000;
  let turn = 0;
  const beat = async () => {
    const records = names.map((name, index) => fixtureRecord(index, name, startedAt));
    const first = turn++ % records.length;
    for (const record of [...records.slice(first), ...records.slice(0, first)]) {
      await registry.write({ ...record, updatedAt: new Date().toISOString() });
    }
  };
  await beat();
  const timer = setInterval(() => { void beat().catch(() => {}); }, 1_000);
  return { stop: () => clearInterval(timer) };
}

function selectedLine(text: string): string {
  return text.split('\n').find((line) => line.trimStart().startsWith('›')) ?? '';
}

/**
 * Walks the live session list with the arrow keys across several refreshes,
 * opens one session, and leaves through Escape.
 */
export async function navigateActiveAgentSessions(session: Session, names: [string, string, string]): Promise<{ list: string; details: string }> {
  const [first, second, third] = names;
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('Active Autohand Agents') && selectedLine(text).includes(first) });
  await session.press('down');
  await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(second) });
  await new Promise<void>((resolve) => setTimeout(resolve, 3_500));
  const list = await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(second) });
  await session.press('down');
  await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(third) });
  await session.press('up');
  await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(second) });
  await session.press('enter');
  const details = await session.text({
    timeout: 5_000,
    waitFor: (text) => text.includes(`Workspace: /fixture/${second}`) && text.includes(`Instruction for ${second}`),
  });
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Active Autohand Agents') && selectedLine(text).includes(second) });
  await session.press('escape');
  return { list, details };
}

export const PROTOCOL_ESCAPE = '\u001b[27u';
export const PROTOCOL_CTRL_C = '\u001b[99;5u';

/**
 * Opens the live session list from inside an interactive session, where the
 * kitty keyboard protocol is on and terminals report Escape and Ctrl+C as CSI-u
 * sequences, then leaves details with Escape and the view with Ctrl+C.
 */
export async function leaveActiveAgentDetailsWithProtocolKeys(
  session: Session,
  names: [string, string],
  keys: { escape: string; ctrlC: string } = { escape: PROTOCOL_ESCAPE, ctrlC: PROTOCOL_CTRL_C },
): Promise<{ details: string; list: string }> {
  const [first, second] = names;
  await session.type('/agents --live');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/agents --live') });
  await session.press('enter');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('Active Autohand Agents') && selectedLine(text).includes(first) });
  await session.press('down');
  await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(second) });
  await session.press('enter');
  const details = await session.text({ timeout: 5_000, waitFor: (text) => text.includes(`Workspace: /fixture/${second}`) });
  session.writeRaw(keys.escape);
  const list = await session.text({
    timeout: 5_000,
    waitFor: (text) => text.includes('Active Autohand Agents') && selectedLine(text).includes(second) && !text.includes('Workspace: /fixture/'),
  });
  await session.press('enter');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes(`Workspace: /fixture/${second}`) });
  session.writeRaw(keys.ctrlC);
  await session.text({ timeout: 10_000, waitFor: (text) => !text.includes('Active Autohand Agents') && !text.includes('Workspace: /fixture/') && text.includes('? shortcuts') });
  return { details, list };
}

export interface SavedSessionSeed {
  sessionId: string;
  title: string;
  projectPath: string;
  firstPrompt: string;
  reply: string;
  minutesAgo: number;
}

/** Writes saved sessions and the session index the way the session store lays them out on disk. */
export async function seedSavedSessions(autohandHome: string, seeds: SavedSessionSeed[]): Promise<void> {
  const sessionsDir = path.join(autohandHome, 'sessions');
  const index: { sessions: Array<{ id: string; projectPath: string; createdAt: string }>; byProject: Record<string, string[]> } = { sessions: [], byProject: {} };
  for (const seed of seeds) {
    const date = new Date(Date.now() - seed.minutesAgo * 60_000).toISOString();
    const metadata = {
      sessionId: seed.sessionId, createdAt: date, lastActiveAt: date, projectPath: seed.projectPath,
      projectName: path.basename(seed.projectPath), model: 'openai/gpt-4o-mini', messageCount: 2, status: 'completed' as const, title: seed.title,
    };
    const directory = path.join(sessionsDir, seed.sessionId);
    await mkdir(directory, { recursive: true });
    const session = new SavedSession(directory, metadata);
    await session.appendTransient({ role: 'user', content: seed.firstPrompt, timestamp: date });
    await session.appendTransient({ role: 'assistant', content: seed.reply, timestamp: date });
    await session.save();
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata));
    index.sessions.push({ id: seed.sessionId, projectPath: seed.projectPath, createdAt: date });
    index.byProject[seed.projectPath] = [...index.byProject[seed.projectPath] ?? [], seed.sessionId];
  }
  await writeFile(path.join(sessionsDir, 'index.json'), JSON.stringify(index));
}

/** The visible terminal grid, one string per row, so a row index is a real terminal row. */
function terminalRows(session: Session): string[] {
  const data = session.getTerminalData();
  return data.lines.slice(-data.rows).map((line) => line.spans.map((span) => span.text).join(''));
}

async function openSessionCenter(session: Session): Promise<string> {
  await session.type('/agents');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/agents') });
  await session.press('enter');
  return session.text({ timeout: 15_000, waitFor: (text) => text.includes('Agent sessions') && text.includes('enter open') && text.includes('Inactive ') });
}

async function selectSessionRow(session: Session, title: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const text = await session.text({ immediate: true });
    if (selectedLine(text).includes(title)) return text;
    await session.press(attempt < 6 ? 'down' : 'up');
    await session.waitIdle();
  }
  throw new Error(`Could not select "${title}":\n${await session.text({ immediate: true })}`);
}

export interface SessionSwitchResult { center: string; directoryStep: string; first: string; second: string; }

/**
 * From inside an interactive session: open the session command center, leave it with a
 * protocol-encoded Escape, reopen it, switch into a session saved in another directory with the
 * keyboard, then switch to a third session with the mouse, typing in the composer after each switch.
 */
export async function switchBetweenSavedSessions(
  session: Session,
  target: { first: SavedSessionSeed; second: SavedSessionSeed },
): Promise<SessionSwitchResult> {
  await openSessionCenter(session);
  session.writeRaw(PROTOCOL_ESCAPE);
  await session.text({ timeout: 10_000, waitFor: (text) => !text.includes('Agent sessions') && text.includes('? shortcuts') });
  await session.waitIdle();

  const center = await openSessionCenter(session);
  await selectSessionRow(session, target.first.title);
  await session.press('enter');
  const directoryStep = await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Working directory') && text.includes('1. Use session directory') });
  await session.press('enter');
  const first = await session.text({ timeout: 20_000, waitFor: (text) => !text.includes('Agent sessions') && text.includes(target.first.reply) && text.includes('? shortcuts') });
  await session.waitIdle();
  await session.type('typed after first switch');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('typed after first switch') });
  for (let index = 0; index < 'typed after first switch'.length; index += 1) await session.press('backspace');
  await session.waitIdle();

  await openSessionCenter(session);
  const viewport = terminalRows(session);
  const row = viewport.findIndex((line) => line.includes(target.second.title) && line.includes('Inactive'));
  if (row < 0) throw new Error(`"${target.second.title}" is not listed:\n${viewport.join('\n')}`);
  const column = viewport[row]!.indexOf(target.second.title) + 2;
  session.writeRaw(`\u001b[<0;${column};${row + 1}M\u001b[<0;${column};${row + 1}m`);
  await session.text({ timeout: 5_000, waitFor: (text) => selectedLine(text).includes(target.second.title) });
  session.writeRaw(`\u001b[<0;${column};${row + 1}M\u001b[<0;${column};${row + 1}m`);
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Working directory') && text.includes('2. Use current directory') });
  await session.press('2');
  const second = await session.text({ timeout: 20_000, waitFor: (text) => !text.includes('Agent sessions') && text.includes(target.second.reply) && text.includes('? shortcuts') });
  await session.waitIdle();
  await session.type('typed after second switch');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('typed after second switch') });
  return { center, directoryStep, first, second };
}
