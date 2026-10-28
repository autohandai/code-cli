import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit,
  type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function launch(tmux = false) {
  const state = await createTempAutohandHome({ config: {
    agent: { autoMemory: false }, ui: { promptSuggestions: false },
  } });
  states.push(state);
  git(state.workspaceRoot, 'config', 'user.name', 'Worktree Tests');
  git(state.workspaceRoot, 'config', 'user.email', 'tests@autohand.ai');
  await writeFile(path.join(state.workspaceRoot, '.gitignore'), '.autohand/\n');
  git(state.workspaceRoot, 'add', '.');
  git(state.workspaceRoot, 'commit', '-qm', 'Initial fixture');
  const session = await launchBuiltAutohand(['--worktree', 'cleanup-fixture', '--config', state.configPath, '--offline'], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot,
    env: { AUTOHAND_TMUX_LAUNCHED: tmux ? '1' : undefined },
  });
  sessions.push(session);
  await session.waitForText('❯');
  const worktreePath = `${state.workspaceRoot}-cleanup-fixture`;
  expect(existsSync(worktreePath)).toBe(true);
  return { state, session, worktreePath };
}

describe('--worktree exit cleanup', () => {
  it('removes the sibling directory, registration and new branch after a clean interactive exit', async () => {
    const { state, session, worktreePath } = await launch();
    await exitInteractive(session);
    expect(existsSync(worktreePath), session.readAll()).toBe(false);
    expect(git(state.workspaceRoot, 'worktree', 'list', '--porcelain')).not.toContain(worktreePath);
    expect(git(state.workspaceRoot, 'branch', '--list', 'cleanup-fixture')).toBe('');
    expect(session.exitInfo?.exitCode).toBe(0);
  });

  it.each(['untracked', 'committed'])('keeps %s work and prints its recovery path and branch', async kind => {
    const { state, session, worktreePath } = await launch();
    const file = path.join(worktreePath, 'valuable.txt');
    await writeFile(file, 'session work\n');
    if (kind === 'committed') {
      git(worktreePath, 'add', '.');
      git(worktreePath, 'commit', '-qm', 'Preserve session work');
    }
    await exitInteractive(session);
    expect(await readFile(file, 'utf8')).toBe('session work\n');
    expect(session.readAll()).toContain('Kept worktree');
    expect(session.readAll()).toContain('(branch cleanup-fixture) with changes');
    expect(session.readAll()).toContain(worktreePath);
    expect(git(state.workspaceRoot, 'branch', '--list', 'cleanup-fixture')).toContain('cleanup-fixture');
  });

  it('preserves the existing tmux-child worktree behavior', async () => {
    const { session, worktreePath } = await launch(true);
    await exitInteractive(session);
    expect(existsSync(worktreePath)).toBe(true);
    expect(session.readAll()).not.toContain('Removed worktree');
  });

  it.each([
    { patch: false, tmux: false },
    { patch: true, tmux: false },
    { patch: true, tmux: true },
  ])('cleans up only non-tmux command worktrees (patch=$patch, tmux=$tmux)', async ({ patch, tmux }) => {
    const server = await createMockAutohandAINativeSequenceServer([{ content: 'WORKTREE_COMMAND_DONE' }]);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    git(state.workspaceRoot, 'config', 'user.name', 'Worktree Tests');
    git(state.workspaceRoot, 'config', 'user.email', 'tests@autohand.ai');
    await writeFile(path.join(state.workspaceRoot, '.gitignore'), '.autohand/\n');
    git(state.workspaceRoot, 'add', '.');
    git(state.workspaceRoot, 'commit', '-qm', 'Initial fixture');
    const session = await launchBuiltAutohand([
      '--worktree', 'cleanup-fixture', '--config', state.configPath, '--offline', '--yes', '-p', 'Respond without editing files.',
      ...(patch ? ['--patch'] : []),
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_TMUX_LAUNCHED: tmux ? '1' : undefined } });
    sessions.push(session);
    await waitForExit(session, 30_000);
    expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
    expect(server.requests.length).toBeGreaterThan(0);
    expect(existsSync(`${state.workspaceRoot}-cleanup-fixture`), session.readAll()).toBe(tmux);
    const branches = git(state.workspaceRoot, 'branch', '--list', 'cleanup-fixture');
    if (tmux) expect(branches).toContain('cleanup-fixture');
    else expect(branches).toBe('');
  });
});
