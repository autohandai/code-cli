import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import { AutomodeManager, getAutomodeOptions } from '../src/core/AutomodeManager.js';
import type { AutomodeSettings, LoadedConfig } from '../src/types.js';

describe('auto-mode explicit review and recovery', () => {
  let root: string;
  let workspace: string;
  let output: string[];
  const worktrees = new Set<string>();

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automode-recovery-D-'));
    workspace = path.join(root, "reviewer's -D --force project");
    await fs.ensureDir(workspace);
    vi.stubEnv('AUTOHAND_HOME', path.join(root, 'private-state'));
    git(workspace, 'init', '--initial-branch=main');
    git(workspace, 'config', 'user.name', 'Recovery fixture');
    git(workspace, 'config', 'user.email', 'fixture@example.com');
    git(workspace, 'config', 'commit.gpgsign', 'false');
    git(workspace, 'config', 'core.hooksPath', '/dev/null');
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Fixture\nRun checks before committing.\n');
    git(workspace, 'add', 'AGENTS.md');
    git(workspace, 'commit', '-m', 'Initial fixture');
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(stripAnsi(args.map(String).join(' ')));
    });
  });

  afterEach(async () => {
    try {
      for (const worktree of worktrees) {
        if (await fs.pathExists(worktree)) git(workspace, 'worktree', 'remove', '--force', worktree);
      }
    } finally {
      worktrees.clear();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await fs.remove(root);
    }
  });

  function config(automode: AutomodeSettings = {}): LoadedConfig {
    return {
      configPath: path.join(root, 'config.json'),
      provider: 'openrouter',
      openrouter: { apiKey: 'fixture-key', model: 'fixture-model' },
      automode,
    };
  }

  async function prepare(settings: AutomodeSettings = {}) {
    const manager = new AutomodeManager(config(settings), workspace);
    const worktree = await manager.prepareWorktree(true);
    if (!worktree) throw new Error('Expected a real isolated worktree');
    worktrees.add(worktree);
    return { manager, worktree };
  }

  function command(label: string): string {
    const line = output.flatMap(item => item.split('\n')).map(item => item.trim())
      .find(item => item.startsWith(label));
    expect(line, output.join('\n')).toBeDefined();
    return line?.slice(label.length).trim() ?? '';
  }

  it('keeps a finished task on its branch until the printed merge command is explicitly run', async () => {
    const initial = git(workspace, 'rev-parse', 'HEAD');
    const { manager, worktree } = await prepare();
    await manager.start({ prompt: 'Create task.txt', useWorktree: true, maxIterations: 2 }, async () => {
      await fs.writeFile(path.join(worktree, 'task.txt'), 'completed\n');
      return { success: true, actions: ['write_file'], filesCreated: 1, output: '<promise>DONE</promise>' };
    });
    expect(manager.getState()?.status).toBe('completed');
    expect(git(workspace, 'rev-parse', 'HEAD')).toBe(initial);
    expect(git(workspace, 'status', '--porcelain')).toBe('');
    expect(await fs.readFile(path.join(worktree, 'task.txt'), 'utf8')).toBe('completed\n');
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(git(worktree, 'show', 'HEAD:task.txt')).toBe('completed');
  });

  it.runIf(process.platform !== 'win32')('prints working review, merge and safe cleanup commands for paths containing spaces and apostrophes', async () => {
    const { manager, worktree } = await prepare();
    await manager.start({ prompt: 'Create task.txt', useWorktree: true, maxIterations: 2 }, async () => {
      await fs.writeFile(path.join(worktree, 'task.txt'), 'reviewed\n');
      return { success: true, actions: ['write_file'], filesCreated: 1, output: '<promise>DONE</promise>' };
    });
    const run = (text: string) => execSync(text, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run(command('Review:'));
    run(command('Switch:'));
    run(command('Merge:'));
    expect(await fs.readFile(path.join(workspace, 'task.txt'), 'utf8')).toBe('reviewed\n');
    expect(command('Cleanup worktree:')).toContain(' worktree remove -- ');
    expect(command('Cleanup branch:')).toContain(' branch -d -- ');
    run(command('Cleanup worktree:'));
    run(command('Cleanup branch:'));
    expect(await fs.pathExists(worktree)).toBe(false);
  });

  it.each(['done', 'cap', 'breaker', 'cancel', 'error'] as const)('prints branch, worktree and recovery commands on %s', async outcome => {
    const { manager, worktree } = await prepare({ noProgressThreshold: 1 });
    await manager.start({ prompt: 'Run one step', useWorktree: true, maxIterations: 1 }, async () => {
      if (outcome === 'error') throw new Error('Fixture iteration failed');
      if (outcome === 'cancel') await manager.cancel('user_escape');
      return {
        success: true,
        actions: ['inspect_project'],
        filesModified: outcome === 'breaker' ? 0 : 1,
        output: outcome === 'done' ? '<promise>DONE</promise>' : 'Still working',
      };
    });
    expect(output.join('\n')).toContain(`Branch: ${manager.getBranchName()}`);
    expect(output.join('\n')).toContain(`Worktree: ${worktree}`);
    expect(command('Merge:')).toContain('git');
    expect(command('Cleanup worktree:')).toContain(' worktree remove -- ');
    expect(await fs.pathExists(worktree)).toBe(true);
    expect(git(workspace, 'status', '--porcelain')).toBe('');
  });

  it('accepts a successful completion marker before a no-progress breaker', async () => {
    const manager = new AutomodeManager(config({ noProgressThreshold: 1 }), workspace);
    await manager.start({ prompt: 'Answer the question', useWorktree: false, maxIterations: 3 }, async () => ({
      success: true, actions: ['read_file'], output: '<promise>DONE</promise>',
    }));
    expect(manager.getState()?.status).toBe('completed');
    expect(manager.getState()?.currentIteration).toBe(1);
  });

  it('does not accept a marker from a failed iteration', async () => {
    const manager = new AutomodeManager(config({ noProgressThreshold: 5 }), workspace);
    await manager.start({ prompt: 'Run checks', useWorktree: false, maxIterations: 1 }, async () => ({
      success: false, actions: ['read_file'], output: '<promise>DONE</promise>', error: 'Fixture failure',
    }));
    expect(manager.getState()?.status).toBe('cancelled');
    expect(manager.getState()?.cancelReason).toBe('max_iterations');
  });

  it.each(['flag', 'config'] as const)('rejects an unsupported CLI cost cap from %s before a task can start', source => {
    expect(() => getAutomodeOptions(
      { autoMode: 'Do not start', ...(source === 'flag' ? { maxCost: 0.01 } : {}) },
      config(source === 'config' ? { maxCost: 0.01 } : {}),
    )).toThrow(source === 'flag' ? /max-cost.*not supported/i : /automode.maxCost.*isn.t supported/i);
  });
});
