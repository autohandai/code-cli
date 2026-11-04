import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSkillVerificationCheck } from '../../../src/core/agent/SkillVerificationExecution.js';
import type { PermissionDecision } from '../../../src/permissions/types.js';
import type { SkillLearningCheck } from '../../../src/skills/SkillLearningRuntime.js';
import { ResourceCoordinator } from '../../../src/session/peers/ResourceCoordinator.js';
import { withCommandCoordination } from '../../../src/session/peers/CommandCoordinationGate.js';
import * as coordination from '../../../src/session/peers/CommandCoordinationGate.js';
import type { ChildProcess } from 'node:child_process';

const roots: string[] = [];
const spawned = vi.hoisted(() => ({ child: undefined as ChildProcess | undefined, closed: undefined as Promise<void> | undefined }));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    spawned.child = child;
    spawned.closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    return child;
  } };
});
const nativeSetTimeout = globalThis.setTimeout;
async function waitForProcessState(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
  while (!await predicate()) {
    if (process.hrtime.bigint() >= deadline) throw new Error('Verification fixture did not reach its expected process state.');
    await new Promise<void>(resolve => nativeSetTimeout(resolve, 10));
  }
}
async function setup(decision: PermissionDecision = { allowed: true, reason: 'allow_list' }) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-verifier-'));
  roots.push(workspaceRoot);
  return { workspaceRoot, permissionManager: { checkPermission: vi.fn(() => decision) }, signal: new AbortController().signal };
}
const check = (code: string, extra: string[] = []): SkillLearningCheck => ({ id: 'frozen-check', command: [process.execPath, '-e', code, ...extra], files: ['independent.cjs'], timeoutMs: 3_000 });
afterEach(async () => {
  try {
    const child = spawned.child;
    if (child?.pid) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
    await spawned.closed;
  } finally {
    spawned.child = undefined;
    spawned.closed = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    await Promise.all(roots.splice(0).map(root => fs.remove(root)));
  }
});

describe('permission-bound skill check execution', () => {
  it.each<PermissionDecision>([{ allowed: false, reason: 'deny_list' }, { allowed: false, reason: 'default' },
    { allowed: false, reason: 'mode_restricted' }, { allowed: false, reason: 'external_denied' }, { allowed: true, reason: 'default' }])('never launches a process for disposition $reason', async decision => {
    const options = await setup(decision);
    const marker = path.join(options.workspaceRoot, 'must-not-run');
    expect(await runSkillVerificationCheck({ ...options, check: check('require("node:fs").writeFileSync(process.argv[1],"ran")', [marker]) })).toEqual({ executed: false, exitCode: null });
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it('reports the real exit code and hashes output without returning credentials or raw output', async () => {
    const options = await setup();
    const result = await runSkillVerificationCheck({ ...options, check: check('process.stdout.write("private-fixture-output");process.stderr.write("failed-check");process.exitCode=7') });
    expect(result).toMatchObject({ executed: true, exitCode: 7, outputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(JSON.stringify(result)).not.toContain('private-fixture-output');
    expect(options.permissionManager.checkPermission).toHaveBeenCalledWith(expect.objectContaining({ tool: 'run_command', command: process.execPath, args: expect.any(Array), path: await fs.realpath(options.workspaceRoot) }));
  });

  it('passes argv literally and applies the existing child environment policy', async () => {
    const options = await setup();
    const marker = path.join(options.workspaceRoot, 'injected');
    const literal = `$(touch ${marker}); echo unsafe`;
    const result = await runSkillVerificationCheck({ ...options, check: check('process.stdout.write(process.argv[1]);process.stdout.write(process.env.VERIFIER_FIXTURE)', [literal]),
      shellSettings: { env: { inherit: 'none', set: { VERIFIER_FIXTURE: 'policy-value' } } } });
    const streamHash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(result.outputDigest).toBe(`sha256:${streamHash(JSON.stringify({ stdout: streamHash(`${literal}policy-value`), stderr: streamHash('') }))}`);
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it('rejects escaping and symbolic working directories without launching', async () => {
    const options = await setup();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-verifier-outside-'));
    roots.push(outside);
    await fs.symlink(outside, path.join(options.workspaceRoot, 'escape'));
    for (const cwd of [outside, 'escape']) expect(await runSkillVerificationCheck({ ...options, check: { ...check('process.exit(0)'), cwd } })).toEqual({ executed: false, exitCode: null });
  });

  it.each(['cancel', 'deadline'] as const)('cleans a SIGTERM-resistant parent and descendants on %s', async mode => {
    const options = await setup();
    const marker = path.join(options.workspaceRoot, 'pids.json');
    const controller = new AbortController();
    const code = 'const{spawn}=require("node:child_process");process.on("SIGTERM",()=>{});const c=spawn(process.execPath,["-e",\'process.on("SIGTERM",()=>{});setTimeout(()=>process.exit(1),20000).unref();process.stdout.write("READY");setInterval(()=>{},1000)\'],{stdio:["ignore","pipe","ignore"]});c.stdout.once("data",()=>require("node:fs").writeFileSync(process.argv[1],JSON.stringify([process.pid,c.pid])));setInterval(()=>{},1000);';
    const timeoutMs = mode === 'deadline' ? 600 : 5_000;
    const nativeDeadline = new AbortController();
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const timers = vi.getTimerCount();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === timeoutMs ? nativeDeadline.signal : originalTimeout(ms));
    const pending = runSkillVerificationCheck({ ...options, signal: controller.signal, check: { ...check(code, [marker]), timeoutMs } });
    let pids: number[] = [];
    try {
      await waitForProcessState(() => fs.pathExists(marker), 15_000);
      pids = await fs.readJson(marker) as number[];
      expect(pids).toHaveLength(2);
      for (const pid of pids) expect(() => process.kill(pid, 0)).not.toThrow();
      expect(timeout).toHaveBeenCalledWith(timeoutMs);
      if (mode === 'cancel') controller.abort();
      else {
        await vi.advanceTimersByTimeAsync(600);
        nativeDeadline.abort(new DOMException('Fixture deadline', 'TimeoutError'));
      }
      await vi.advanceTimersByTimeAsync(250);
      expect(await pending).toMatchObject({ executed: true, exitCode: null });
      await waitForProcessState(() => pids.every(pid => {
        try { process.kill(pid, 0); return false; } catch { return true; }
      }), 3_000);
      expect(vi.getTimerCount()).toBe(timers);
    } finally {
      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      await pending;
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it('bounds output and never accepts a noisy check as a passed acceptance check', async () => {
    const options = await setup();
    expect(await runSkillVerificationCheck({ ...options, check: check('process.stdout.write("x".repeat(2*1024*1024))') })).toMatchObject({ executed: true, exitCode: null });
  });

  it('rechecks permissions after coordinated resource waiting and never launches after revocation', async () => {
    const options = await setup();
    const resource = 'machine/skill-verification';
    const lead = new ResourceCoordinator({ directory: options.workspaceRoot, principal: { peerId: 'lead', instanceId: 'lead' }, canControl: true, isPrincipalAlive: async () => true });
    const worker = new ResourceCoordinator({ directory: options.workspaceRoot, principal: { peerId: 'worker', instanceId: 'worker' }, canControl: false, isPrincipalAlive: async () => true });
    const marker = path.join(options.workspaceRoot, 'revoked-marker');
    try {
      await lead.coordinate({ operation: 'set_controller', resource, controller: 'lead', participants: ['worker'], profile: 'strict' });
      const result = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 3_000 }, () => runSkillVerificationCheck({ ...options,
        check: check('require("node:fs").writeFileSync(process.argv[1],"ran")', [marker]) }));
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1));
      options.permissionManager.checkPermission.mockReturnValue({ allowed: false, reason: 'user_denied' });
      await lead.coordinate({ operation: 'grant', requestId: (await lead.coordinate({ operation: 'status', resource })).queue[0]!.requestId });
      expect(await result).toEqual({ executed: false, exitCode: null });
      expect(await fs.pathExists(marker)).toBe(false);
      expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
    } finally { await Promise.all([lead.close(), worker.close()]); }
  });

  it('releases watchdog timers after an allowed check exits', async () => {
    const options = await setup();
    vi.useFakeTimers();
    try {
      const baseline = vi.getTimerCount();
      expect(await runSkillVerificationCheck({ ...options, check: check('process.exit(0)') })).toMatchObject({ executed: true, exitCode: 0 });
      expect(vi.getTimerCount()).toBe(baseline);
    } finally { vi.useRealTimers(); }
  });

  it('cleans up a spawned process when coordination observation throws', async () => {
    const options = await setup();
    const failed = vi.fn(async () => {});
    let child: ChildProcess | undefined;
    const unavailable = { observe: (process: ChildProcess) => { child = process; throw new Error('observation unavailable'); }, failed } as unknown as Awaited<ReturnType<typeof coordination.prepareCommandCoordination>>;
    vi.spyOn(coordination, 'prepareCommandCoordination').mockResolvedValue(unavailable);
    try {
      expect(await runSkillVerificationCheck({ ...options, check: check('setInterval(()=>{},1000)') })).toEqual({ executed: false, exitCode: null });
      await vi.waitFor(() => expect(() => process.kill(child!.pid!, 0)).toThrow(), { timeout: 500 });
      expect(failed).toHaveBeenCalledOnce();
    } finally {
      if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }
  });
});
