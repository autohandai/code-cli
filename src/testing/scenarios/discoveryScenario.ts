import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Session } from 'tuistory';
import { outputViewport } from './compactOutputScenario.js';
import type { PtyDriver } from '../drivers/pty-driver.js';

export async function runDiscoveryProgressPtyScenario(
  driver: PtyDriver,
  command: string,
  args: string[],
  cwd: string
): Promise<string> {
  driver.launch(command, args, { cwd });
  await driver.waitFor('Discover useful workflows');
  await driver.waitFor('Uploading selected drafts');
  const screen = driver.snapshot();
  driver.ctrlC();
  await driver.waitFor('Discovery cancelled');
  return screen;
}

export async function cancelDiscoveryUpload(session: Session): Promise<void> {
  await session.waitForText('Uploading selected workflows', {
    timeout: 20_000,
  });
  await session.press(['ctrl', 'c']);
}

export const DISCOVERY_SCAN_NOTICE = 'Scanning this workspace for workflows';
export const COLLECTOR_FAILURE_DETAIL = 'collector exploded';

/** Project skills too large to read: each one makes the collector add a "Skipped…" note. */
export async function seedOversizedSkills(workspaceRoot: string, count: number): Promise<void> {
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const root = path.join(workspaceRoot, '.agents/skills', `broken-${String(index + 1).padStart(2, '0')}`);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'SKILL.md'), `---\nname: broken-${index + 1}\ndescription: oversized fixture\n---\n${'x'.repeat(70_000)}`);
  }));
}

/** NODE_OPTIONS that make only the discovery collector child exit with an error. */
export async function failingCollectorNodeOptions(directory: string): Promise<string> {
  const preload = path.join(directory, 'fail-collector.mjs');
  await writeFile(preload, `if (process.env.AUTOHAND_DISCOVERY_CHILD === '1') { console.error(${JSON.stringify(COLLECTOR_FAILURE_DETAIL)}); process.exit(3); }\n`);
  return `--import=${pathToFileURL(preload).href}`;
}

/** The composer row: the last prompt line on screen, below any echoed commands. */
function composerLine(session: Session): string {
  return outputViewport(session).split('\n').reverse().find(line => line.trimStart().startsWith('❯'))?.trim() ?? '';
}

/** Submits once the composer shows the whole line, so Enter is never coalesced into the typed burst. Returns when Enter was sent. */
export async function submitComposerLine(session: Session, text: string): Promise<number> {
  await session.type(text);
  await session.text({ timeout: 15_000, waitFor: () => composerLine(session) === `❯ ${text.trim()}` });
  const submittedAt = Date.now();
  await session.press('enter');
  return submittedAt;
}

export function runDiscoveryCommand(session: Session, argument = ''): Promise<number> {
  return submitComposerLine(session, `/discovery ${argument}`);
}

/** True once the composer holds no draft: it shows its placeholder, not a typed command. */
export function composerIsEmpty(session: Session): boolean {
  return !composerLine(session).startsWith('❯ /');
}

export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
