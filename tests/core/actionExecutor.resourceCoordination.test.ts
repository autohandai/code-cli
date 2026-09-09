import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { ResourceCoordinator } from '../../src/session/peers/ResourceCoordinator.js';
import { withCommandCoordination } from '../../src/session/peers/CommandCoordinationGate.js';
import { HookManager } from '../../src/core/HookManager.js';
import { CodeQualityPipeline } from '../../src/core/CodeQualityPipeline.js';
import type { CLIOptions } from '../../src/types.js';

let directory: string;
let lead: ResourceCoordinator;
let worker: ResourceCoordinator;
const resource = 'machine/build';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-executor-resource-'));
  const shared = path.join(directory, 'resources');
  lead = new ResourceCoordinator({ directory: shared, principal: { peerId: 'peer-lead', instanceId: 'lead' }, canControl: true, isPrincipalAlive: async () => true });
  worker = new ResourceCoordinator({ directory: shared, principal: { peerId: 'peer-worker', instanceId: 'worker' }, canControl: false, isPrincipalAlive: async () => true });
  await lead.coordinate({ operation: 'set_controller', resource, controller: 'peer-lead', participants: ['peer-worker'], profile: 'strict' });
});
afterEach(async () => {
  await Promise.allSettled([lead.close(), worker.close()]);
  await rm(directory, { recursive: true, force: true });
});

function executor(options: CLIOptions = {}, autoConfirm = false, waitTimeoutMs = 15) {
  return new ActionExecutor({
    runtime: { workspaceRoot: directory, config: { configPath: '', ui: { autoConfirm } }, options },
    files: new FileActionManager(directory), resolveWorkspacePath: relative => path.resolve(directory, relative),
    confirmDangerousAction: async () => true,
    resourceCoordinator: () => worker, resourceWaitTimeoutMs: waitTimeoutMs,
  });
}

describe('resource policy through the production action executor', () => {
  it.each([
    ['yes', { yes: true }, false],
    ['unrestricted', { unrestricted: true }, false],
    ['auto-confirm', {}, true],
    ['yolo', { yolo: true }, false],
  ] as const)('keeps coordination independent of %s permission mode', async (_label, options, autoConfirm) => {
    const marker = path.join(directory, 'never-started');
    const result = await executor(options, autoConfirm).executeForTool({ type: 'run_command', command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"started")', marker] }, { approvalHandled: true });
    expect(result.success).toBe(false);
    expect(`${result.output}`).toContain('RESOURCE_WAIT_TIMEOUT');
    expect(existsSync(marker)).toBe(false);
  });

  it.each(['run_command', 'shell'] as const)('gates %s, including background launches', async type => {
    const marker = path.join(directory, 'background-marker');
    const result = await executor({ yes: true }).executeForTool({ type, command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"started")', marker], background: true }, { approvalHandled: true });
    expect(result.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it('revalidates policy after a permission prompt before a process can start', async () => {
    const ticket = await worker.coordinate({ operation: 'request', resource, reason: 'test permission race' });
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId! });
    const marker = path.join(directory, 'policy-race');
    const actions = new ActionExecutor({
      runtime: { workspaceRoot: directory, config: { configPath: '' }, options: {} },
      files: new FileActionManager(directory), resolveWorkspacePath: relative => path.resolve(directory, relative),
      confirmDangerousAction: async () => {
        await lead.coordinate({ operation: 'set_controller', resource, controller: 'peer-lead', participants: [], profile: 'strict' });
        return true;
      },
      resourceCoordinator: () => worker, resourceWaitTimeoutMs: 15,
    });
    const result = await actions.executeForTool({ type: 'run_command', command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"started")', marker] });
    expect(result.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('additional participating process launchers', () => {
  it('gates lifecycle-hook shell commands before they can create a process', async () => {
    const marker = path.join(directory, 'hook-marker');
    const script = path.join(directory, 'hook.cjs');
    await writeFile(script, 'require("node:fs").writeFileSync(process.argv[2],"started")');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const hooks = new HookManager({ workspaceRoot: directory, settings: { enabled: true, hooks: [{ event: 'pre-tool', command: `${quote(process.execPath)} ${quote(script)} ${quote(marker)}`, timeout: 5_000 }] } });
    const results = await withCommandCoordination({ coordinator: worker, waitTimeoutMs: 15 }, () => hooks.executeHooks('pre-tool', { tool: 'run_command' }));
    expect(existsSync(marker)).toBe(false);
    expect(results.some(result => result.success === false)).toBe(true);
    expect(JSON.stringify(results)).toContain('RESOURCE_WAIT_TIMEOUT');
  });

  it('gates native quality build and test scripts instead of bypassing the resource policy', async () => {
    const marker = path.join(directory, 'quality-marker');
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'gate-fixture', scripts: { build: 'node build.cjs', test: 'node build.cjs' } }));
    await writeFile(path.join(directory, 'build.cjs'), `require("node:fs").writeFileSync(${JSON.stringify(marker)},"started")`);
    const result = await withCommandCoordination({ coordinator: worker, waitTimeoutMs: 15 }, () => new CodeQualityPipeline().run(directory, { skipLint: true, skipTypecheck: true }));
    expect(existsSync(marker)).toBe(false);
    expect(result.checks.some(check => check.status === 'failed')).toBe(true);
  });

  it('allows a nested process under its existing reservation without recursively waiting for a grant', async () => {
    const marker = path.join(directory, 'nested-marker');
    const childCode = 'process.stdout.write("nested")';
    await writeFile(path.join(directory, 'nested.cjs'), `require("node:child_process").execFileSync(process.execPath,["-e",${JSON.stringify(childCode)}]); require("node:fs").writeFileSync(process.argv[2],"done")`);
    const running = executor({ yes: true }, false, 5_000).executeForTool({ type: 'run_command', command: process.execPath, args: [path.join(directory, 'nested.cjs'), marker] }, { approvalHandled: true });
    await vi.waitFor(async () => {
      const status = await lead.coordinate({ operation: 'status', resource });
      expect(status.queue).toHaveLength(1);
      await lead.coordinate({ operation: 'grant', requestId: status.queue[0].requestId });
    }, { interval: 1, timeout: 1_000 });
    expect(await running).toMatchObject({ success: true });
    expect(existsSync(marker)).toBe(true);
  });
});
