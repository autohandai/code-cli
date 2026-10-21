import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { SessionManager } from '../../src/session/SessionManager.js';
import { seedResumeScenario } from '../../src/testing/scenarios/resumeScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, waitForExit, type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});
async function launch(args: string[], seed = true) {
  const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
  states.push(state);
  if (seed) await seedResumeScenario(state.autohandHome, state.workspaceRoot);
  const session = await launchBuiltAutohand([...args, '--config', state.configPath, '--offline'], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot,
  });
  sessions.push(session);
  return { state, session };
}

describe('continue and resume startup flags', () => {
  it('shows the new flags and long-only auto-commit in help', async () => {
    const { session } = await launch(['--help'], false);
    await waitForExit(session);
    const output = session.readAll();
    expect(output).toContain('-c, --continue');
    expect(output).toContain('-r, --resume [id]');
    expect(output).toMatch(/\n\s+--auto-commit\s/);
    expect(output).not.toContain('-c, --auto-commit');
  });
  it.each(['-c', '--continue', '-r resume-active', '--resume resume-active'])('%s resumes the current-folder session', async flags => {
    const { session } = await launch(flags.split(' '));
    await session.waitForText('Resumed session resume-active', { timeout: 30_000 });
    expect(session.readAll()).not.toContain('Resumed session elsewhere-session');
    await session.waitForText('❯');
    await exitInteractive(session);
  });
  it('-r opens the existing picker and allows cancellation', async () => {
    const { session, state } = await launch(['-r']);
    await session.waitForText('Resume a session');
    expect(await session.text()).toContain('Newer project session');
    await session.press('escape');
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect((await fs.readJson(path.join(state.autohandHome, 'sessions/index.json'))).sessions).toHaveLength(3);
  });
  it('continues into a fresh interactive session with no folder history', async () => {
    const { session } = await launch(['-c'], false);
    await session.waitForText('No previous session in this folder, starting a new one');
    await session.waitForText('❯');
    await exitInteractive(session);
  });
  it.each([['-c'], ['--continue'], ['-r'], ['--resume', 'saved'], ['resume', '--last']].map(args => ({ args })))('rejects --ephemeral with $args before sign-in', async ({ args }) => {
    const { session } = await launch(['--ephemeral', ...args], false);
    await waitForExit(session);
    expect(session.exitInfo?.exitCode).toBe(1);
    expect(session.readAll()).toContain('--ephemeral cannot be combined');
    expect(session.readAll()).not.toContain("unknown option");
  });
  it.each(['-c', '-r'])('%s -p preserves history, session identity, and uncommitted edits', async flag => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Writing the fixture.', toolCall: { id: 'write_continue', name: 'write_file', args: { path: 'continued.txt', contents: 'continued\n' } } },
      { content: 'CONTINUED_HEADLESS_DONE' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 8, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    await seedResumeScenario(state.autohandHome, state.workspaceRoot);
    const manager = new SessionManager(path.join(state.autohandHome, 'sessions'));
    const saved = await manager.loadSession('resume-active');
    await saved.append({ role: 'user', content: 'HISTORY_BEFORE_CONTINUE', timestamp: new Date().toISOString() });
    await saved.append({ role: 'assistant', content: 'Remembered previous work.', timestamp: new Date().toISOString() });
    await saved.save();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: state.workspaceRoot, encoding: 'utf8' }).trim();
    git('config', 'user.name', 'Autohand Tests');
    git('config', 'user.email', 'tests@autohand.ai');
    git('add', '.'); git('commit', '-qm', 'fixture');
    const originalHead = git('rev-parse', 'HEAD');
    const selector = flag === '-r' ? [flag, 'resume-active'] : [flag];
    const session = await launchBuiltAutohand([...selector, '-p', 'hi', '--yes', '--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
    });
    sessions.push(session);
    await waitForExit(session, 30_000);
    expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
    expect(session.readAll()).toContain('CONTINUED_HEADLESS_DONE');
    expect(JSON.stringify(server.requests[0])).toContain('HISTORY_BEFORE_CONTINUE');
    expect(JSON.stringify(server.requests[0])).not.toContain("Set up the elsewhere project's linting config");
    expect(server.requests).toHaveLength(2);
    expect(git('rev-parse', 'HEAD')).toBe(originalHead);
    expect(git('status', '--porcelain')).toContain('?? continued.txt');
    const restored = await manager.loadSession('resume-active');
    expect(restored.getMessages().some(message => message.content === 'hi')).toBe(true);
    expect((await fs.readJson(path.join(state.autohandHome, 'sessions/index.json'))).sessions).toHaveLength(3);
  }, 60_000);
});
