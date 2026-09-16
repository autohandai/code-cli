import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import type { Session } from 'tuistory';
import { chooseOlderResumeSession, chooseResumeSession, seedResumeScenario } from '../../src/testing/scenarios/resumeScenario.js';
import {
  createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

/**
 * The picker's age column ("just now", "3d ago", "36w ago") is relative to
 * the moment the test runs, so a stored snapshot would drift and eventually
 * fail on its own. Replace it with a stable placeholder before comparing or
 * storing a snapshot.
 */
function normalizeVolatileText(text: string): string {
  return text.replace(/\bjust now\b|\b\d+[mhdw] ago\b/gu, '<age>');
}

async function launch(args: string[], seed = true, olderSessionCount = 0) {
  const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
  states.push(state);
  if (seed) await seedResumeScenario(state.autohandHome, state.workspaceRoot, olderSessionCount);
  const session = await launchBuiltAutohand(['resume', ...args, '--config', state.configPath, '--offline'], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot,
  });
  sessions.push(session);
  return { state, session };
}

describe('resume startup Tuistory', () => {
  it('documents optional references, --last, and --all in command help', async () => {
    const { session } = await launch(['--help'], false);
    await waitForExit(session);
    const output = await session.readAll();
    expect(output).toContain('[reference]');
    expect(output).toContain('--last');
    expect(output).toContain('--all');
    expect(session.exitInfo?.exitCode).toBe(0);
  });

  it.each([
    { args: ['--last'], expected: 'resume-active' },
    { args: ['--last', '--all'], expected: 'elsewhere-session' },
  ])('resumes the latest active session for $args', async ({ args, expected }) => {
    const { session, state } = await launch(args);
    await session.waitForText(`Resumed session ${expected}`, { timeout: 30_000 });
    await session.waitForText('❯');
    await exitInteractive(session);
    const index = await fs.readJson(path.join(state.autohandHome, 'sessions', 'index.json'));
    expect(index.sessions).toHaveLength(3);
  });

  it.each([
    { args: [], expected: 'resume-newer', otherProjectVisible: false },
    { args: ['--all'], expected: 'elsewhere-session', otherProjectVisible: true },
  ])('supports keyboard selection for $args', async ({ args, expected, otherProjectVisible }) => {
    const { session } = await launch(args);
    const screen = await chooseResumeSession(session);
    expect(screen).toContain('Newer project session');
    expect(screen.includes('Other project session')).toBe(otherProjectVisible);
    // A single row carries both the title and its message-count/age columns,
    // grouped under a relative-day heading. The fixture sessions are from
    // January 2026, well outside the "Previous 7 days" window, so they group
    // under "Earlier" rather than "Today".
    expect(screen).toMatch(/Earlier\n\s*▸\s*1\.\s+\S.*\s{2,}\d+ msgs\s{2,}\S+ ago/u);
    // `resume-active` has no messages and stays hidden behind the reveal row.
    expect(screen).toMatch(/Show 1 empty session/u);
    await expect(`${normalizeVolatileText(screen.trimEnd())}\n`).toMatchFileSnapshot(path.resolve(
      import.meta.dirname, '../../src/testing/snapshots',
      otherProjectVisible ? 'resume-all-projects.txt' : 'resume-current-project.txt',
    ));
    await session.waitForText(`Resumed session ${expected}`, { timeout: 30_000 });
    await session.waitForText('❯');
    await session.type('resume draft');
    await session.waitForText('❯ resume draft');
    await exitInteractive(session);
  });

  it('navigates forward and backward and resumes a session beyond the first page', async () => {
    const { session } = await launch([], true, 19);
    await session.waitForText('Resume a session');
    await chooseOlderResumeSession(session);
    await session.waitForText('Resumed session older-page-18', { timeout: 30_000 });
    await session.waitForText('❯');
    await exitInteractive(session);
  });

  it.each(['escape', 'ctrl-c'])('cancels the picker using %s without starting a session', async (key) => {
    const { session, state } = await launch([]);
    await session.waitForText('Resume a session');
    if (key === 'ctrl-c') await session.press(['ctrl', 'c']);
    else await session.press('escape');
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    const index = await fs.readJson(path.join(state.autohandHome, 'sessions', 'index.json'));
    expect(index.sessions).toHaveLength(3);
  });

  it('exits on empty history without creating a session', async () => {
    const { session, state } = await launch(['--last'], false);
    await waitForExit(session);
    expect(await session.readAll()).toContain('No sessions found');
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(await fs.pathExists(path.join(state.autohandHome, 'sessions', 'index.json'))).toBe(false);
  });

  it('resumes a session by its saved name', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    states.push(state);
    await seedResumeScenario(state.autohandHome, state.workspaceRoot);
    const sessionsDir = path.join(state.autohandHome, 'sessions');
    const metadataPath = path.join(sessionsDir, 'resume-newer', 'metadata.json');
    await fs.writeJson(metadataPath, { ...(await fs.readJson(metadataPath)), title: 'Caret fix', titleSource: 'user' });
    const indexPath = path.join(sessionsDir, 'index.json');
    const index = await fs.readJson(indexPath);
    index.sessions = index.sessions.map((entry: { id: string }) => (entry.id === 'resume-newer' ? { ...entry, title: 'Caret fix' } : entry));
    await fs.writeJson(indexPath, index);

    const session = await launchBuiltAutohand(['resume', 'caret FIX', '--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
    });
    sessions.push(session);
    await session.waitForText('Resumed session resume-newer', { timeout: 30_000 });
    await session.waitForText('❯');
    await exitInteractive(session);
  });

  it('reports ambiguous references with a nonzero exit', async () => {
    const { session } = await launch(['resume-']);
    await waitForExit(session);
    expect(await session.readAll()).toContain('Ambiguous session reference');
    expect(session.exitInfo?.exitCode).toBe(1);
  });
});
