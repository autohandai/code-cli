/** @license Apache-2.0 */
import path from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import type { Session as TerminalSession } from 'tuistory';
import { outputViewport } from './compactOutputScenario.js';

export interface SeededMemory {
  id: string;
  content: string;
}

/** Writes memory entries the way an earlier session left them: one JSON projection per memory. */
export async function seedMemories(directory: string, memories: readonly SeededMemory[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(memories.map(({ id, content }) => writeFile(
    path.join(directory, `${id}.json`),
    JSON.stringify({ id, content, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' }),
  )));
}

/** Memory entry files left in a directory, ignoring the index. */
export async function memoryEntryFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory).catch(() => [] as string[]);
  return names.filter(name => name.endsWith('.json') && name !== 'index.json').sort();
}

/**
 * Types a line and submits it once the composer has drawn it. Without the pause a busy machine can
 * deliver the last character and Enter in one chunk, which the composer reads as pasted text.
 */
export async function submitLine(session: TerminalSession, line: string): Promise<void> {
  await session.type(line);
  await session.waitForText(line, { timeout: 15_000 });
  await session.waitIdle();
  await session.press('enter');
}

export async function runSlashCommand(session: TerminalSession, command: string): Promise<void> {
  await submitLine(session, command);
}

/** Types a draft so the frame repaints, then reads what is still on screen. */
export async function viewportAfterRedraw(session: TerminalSession, draft: string): Promise<string> {
  await session.type(draft);
  await session.waitForText(`❯ ${draft}`);
  return outputViewport(session);
}

export async function openMemoriesScreen(session: TerminalSession): Promise<void> {
  await runSlashCommand(session, '/memories');
  await session.waitForText('enter save/select', { timeout: 15_000 });
}

/** Flips the "Use memories" checkbox, saves, and waits for the confirmation in the transcript. */
export async function setUseMemories(session: TerminalSession, enabled: boolean): Promise<void> {
  await openMemoriesScreen(session);
  await session.waitForText(`› [${enabled ? ' ' : 'x'}] Use memories`);
  await session.press('space');
  await session.waitForText(`› [${enabled ? 'x' : ' '}] Use memories`);
  await session.press('enter');
  await session.waitForText(`Use memories is now ${enabled ? 'on' : 'off'}.`);
}

/** Sends one instruction and waits until the model's reply for it is on screen. */
export async function runTurnAndWaitForReply(session: TerminalSession, instruction: string, reply: string): Promise<void> {
  await submitLine(session, instruction);
  await session.waitForText(reply, { timeout: 30_000 });
  await session.waitIdle();
}

/** Opens the reset confirmation from the options list. */
export async function openMemoriesResetConfirmation(session: TerminalSession): Promise<void> {
  await session.press('down');
  await session.press('down');
  await session.waitForText('› ' + ' '.repeat(4) + 'Reset all memories');
  await session.press('enter');
  await session.waitForText('Reset all memories?');
}
