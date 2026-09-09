import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResourceCoordinator } from '../../src/session/peers/ResourceCoordinator.js';
import { withCommandCoordination } from '../../src/session/peers/CommandCoordinationGate.js';
import { executeShellCommand, executeShellCommandAsync, executeInteractiveShellCommand, executeStreamingShellCommand } from '../../src/ui/shellCommand.js';
import { applyFormatter } from '../../src/actions/formatters.js';
import { lintFile } from '../../src/actions/linters.js';
import { PtyDriver } from '../../src/testing/drivers/pty-driver.js';
import { EnvironmentBootstrap } from '../../src/core/EnvironmentBootstrap.js';
import { WorktreeManager } from '../../src/actions/worktree.js';
import { HookManager } from '../../src/core/HookManager.js';
import { resolveGoalTemplateInvocation } from '../../src/goals/templates.js';
import { runCommand } from '../../src/actions/command.js';

let directory: string;
let lead: ResourceCoordinator;
let worker: ResourceCoordinator;
const resource = 'machine/strict-command-test';
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-launch-'));
  lead = new ResourceCoordinator({ directory, principal: { peerId: 'lead', instanceId: 'lead' }, canControl: true, isPrincipalAlive: async () => true });
  worker = new ResourceCoordinator({ directory, principal: { peerId: 'worker', instanceId: 'worker' }, canControl: false, isPrincipalAlive: async () => true });
  await lead.coordinate({ operation: 'set_controller', resource, controller: 'lead', participants: ['worker'], profile: 'strict' });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([lead.close(), worker.close()]);
  await rm(directory, { recursive: true, force: true });
});

describe('participating launcher enforcement', () => {
  it.each(['command', 'immediate'] as const)('records %s process ownership before returning its foreground result', async route => {
    let publish = () => {};
    const released = new Promise<void>(resolve => { publish = resolve; });
    const original = worker.recordSpawn.bind(worker);
    const publication = vi.spyOn(worker, 'recordSpawn').mockImplementation(async (...args) => { await released; await original(...args); });
    let settled = false;
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5000 }, () => route === 'command'
      ? runCommand(process.execPath, ['-e', 'process.exit(0)'], directory) : executeShellCommandAsync('true', directory));
    void running.then(() => { settled = true; }, () => { settled = true; });
    try {
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1));
      await lead.coordinate({ operation: 'grant', requestId: (await lead.coordinate({ operation: 'status', resource })).queue[0].requestId });
      await vi.waitFor(() => expect(publication).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(settled).toBe(false);
    } finally { publish(); await running; }
  });

  it('releases the unused starting reservation when a lifecycle hook throws synchronously at spawn', async () => {
    const hooks = new HookManager({ workspaceRoot: directory, settings: { enabled: true, hooks: [{ event: 'pre-tool', command: 'invalid\u0000command' }] } });
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5000 }, () => hooks.executeHooks('pre-tool', { tool: 'run_command' }));
    const result = running.catch(error => error);
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1));
    await lead.coordinate({ operation: 'grant', requestId: (await lead.coordinate({ operation: 'status', resource })).queue[0].requestId });
    expect(await result).toEqual([expect.objectContaining({ success: false })]);
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
  });

  it.each(['bootstrap', 'worktree', 'template'] as const)('parks %s commands under a strict policy', async route => {
    const marker = path.join(directory, 'script-marker');
    const fake = `#!${process.execPath}\nif (process.argv[2] === 'rev-parse') process.stdout.write(process.cwd());\nif (['fetch', 'ci', 'install'].includes(process.argv[2])) require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');`;
    await writeFile(path.join(directory, 'git'), fake, { mode: 0o700 });
    await writeFile(path.join(directory, 'npm'), fake, { mode: 0o700 });
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
    await writeFile(path.join(directory, 'package-lock.json'), '{}');
    await mkdir(path.join(directory, '.pi-goals'));
    await writeFile(path.join(directory, '.pi-goals', 'build.md'), `---\nallow_commands: true\n---\nBuild !\`touch '${marker}'\``);
    const manager = new WorktreeManager(directory);
    vi.spyOn(manager, 'list').mockReturnValue([]);
    const result = await withCommandCoordination({ coordinator: worker, waitTimeoutMs: 30 }, () => route === 'bootstrap'
      ? new EnvironmentBootstrap().run(directory, { skipGitSync: true }) : route === 'worktree'
        ? manager.syncAll({ mainBranch: 'main' }) : resolveGoalTemplateInvocation('build', directory)).catch(error => error);
    expect(result).toBeDefined();
    expect(existsSync(marker)).toBe(false);
    expect((await lead.coordinate({ operation: 'status', resource })).queue).toEqual([]);
  });

  it('gates a real nested PTY launch and retains ownership through its terminal exit', async () => {
    const driver = new PtyDriver();
    driver.launch(process.execPath, ['--import', 'tsx', path.resolve('src/testing/scenarios/peerPtyCommandScenario.ts'), directory]);
    try {
      await driver.waitFor(/WAITING_RESOURCE|RESULT/, 10_000);
      expect(driver.snapshot()).toContain('WAITING_RESOURCE');
      expect(existsSync(path.join(directory, 'pty-marker'))).toBe(false);
      const ticket = (await lead.coordinate({ operation: 'status', resource })).queue[0];
      await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
      await driver.waitFor('RESULT {"success":true', 10_000);
      expect(driver.snapshot()).toContain('PTY command output');
      expect(existsSync(path.join(directory, 'pty-marker'))).toBe(true);
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
    } finally { driver.close(); }
  });

  it.each(['async', 'interactive', 'streaming', 'background'] as const)('parks the %s immediate shell route before its process starts', async route => {
    const marker = path.join(directory, 'marker');
    const command = `touch '${marker}'`;
    let settled = false;
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 1000 }, () => route === 'async'
      ? executeShellCommandAsync(command, directory) : route === 'interactive' ? executeInteractiveShellCommand(command, directory)
        : executeStreamingShellCommand(command, directory, { background: route === 'background' }));
    void running.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(async () => expect(settled || (await lead.coordinate({ operation: 'status', resource })).queue.length > 0).toBe(true));
    expect(existsSync(marker)).toBe(false);
    const ticket = (await lead.coordinate({ operation: 'status', resource })).queue[0];
    expect(ticket).toBeDefined();
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    expect(await running).toMatchObject({ success: true });
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true));
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('fails closed for the synchronous shell API inside a coordinated context', () => {
    const marker = path.join(directory, 'sync-marker');
    const result = withCommandCoordination({ coordinator: worker }, () => executeShellCommand(`touch '${marker}'`, directory));
    expect(result.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it.each(['formatter', 'linter'] as const)('prevents the %s launcher from bypassing a strict wait', async route => {
    const marker = path.join(directory, 'external-marker');
    const executable = path.join(directory, route === 'formatter' ? 'prettier' : 'eslint');
    await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.stdout.write('[]');`, { mode: 0o700 });
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 30 }, () => route === 'formatter'
      ? applyFormatter('prettier', 'let a=1', 'test.js', directory) : lintFile('test.js', 'eslint', directory));
    await expect(running).rejects.toMatchObject({ code: 'RESOURCE_WAIT_TIMEOUT' });
    expect(existsSync(marker)).toBe(false);
  });
});
