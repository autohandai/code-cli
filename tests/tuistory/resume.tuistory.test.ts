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
    await expect(`${screen.trimEnd()}\n`).toMatchFileSnapshot(path.resolve(
      import.meta.dirname, '../../src/testing/snapshots',
      otherProjectVisible ? 'resume-all-projects.txt' : 'resume-current-project.txt',
    ));
    await session.waitForText(`Resumed session ${expected}`, { timeout: 30_000 });
    await session.waitForText('❯');
    await exitInteractive(session);
  });

  it('navigates forward and backward and resumes a session beyond the first page', async () => {
    const { session } = await launch([], true, 19);
    await session.waitForText('Choose a session');
    await chooseOlderResumeSession(session);
    await session.waitForText('Resumed session older-page-18', { timeout: 30_000 });
    await session.waitForText('❯');
    await exitInteractive(session);
  });

  it.each(['escape', 'ctrl-c'])('cancels the picker using %s without starting a session', async (key) => {
    const { session, state } = await launch([]);
    await session.waitForText('Choose a session');
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

  it('reports ambiguous references with a nonzero exit', async () => {
    const { session } = await launch(['resume-']);
    await waitForExit(session);
    expect(await session.readAll()).toContain('Ambiguous session reference');
    expect(session.exitInfo?.exitCode).toBe(1);
  });
});
