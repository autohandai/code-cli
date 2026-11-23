/** @license Apache-2.0 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Session as TerminalSession } from 'tuistory';
import { outputViewport } from './compactOutputScenario.js';
import { submitLine } from './memoriesScenario.js';

/** Environment that makes the CLI read its release history from the recorded GitHub response. */
export const RECORDED_RELEASES_ENV = {
  NODE_OPTIONS: `--import=${pathToFileURL(path.resolve(import.meta.dirname, 'changelogReleasesPreload.mjs')).href}`,
};

/** Runs `/changelog` and returns the screen once the end of the release notes is on it. */
export async function showChangelog(session: TerminalSession): Promise<string> {
  await session.waitForText('❯', { timeout: 15_000 });
  await submitLine(session, '/changelog');
  await session.waitForText('macOS alpha signing', { timeout: 20_000 });
  await session.waitIdle();
  return outputViewport(session);
}

/** Scrolls the full-screen transcript to its first row and returns the screen. */
export async function scrollTranscriptToTop(session: TerminalSession): Promise<string> {
  session.writeRaw('\x1b[1;5H');
  await session.waitForText('Autohand Changelog', { timeout: 10_000 });
  await session.waitIdle();
  return outputViewport(session);
}
