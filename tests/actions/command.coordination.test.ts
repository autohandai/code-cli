import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../../src/actions/command.js';
import { ResourceCoordinator } from '../../src/session/peers/ResourceCoordinator.js';
import { withCommandCoordination } from '../../src/session/peers/CommandCoordinationGate.js';

let directory: string;
let lead: ResourceCoordinator;
let worker: ResourceCoordinator;
const resource = 'machine/build';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-gate-'));
  lead = new ResourceCoordinator({ directory, principal: { peerId: 'peer-lead', instanceId: 'lead' }, canControl: true, isPrincipalAlive: async () => true });
  worker = new ResourceCoordinator({ directory, principal: { peerId: 'peer-worker', instanceId: 'worker' }, canControl: false, isPrincipalAlive: async () => true });
  await lead.coordinate({ operation: 'set_controller', resource, controller: 'peer-lead', participants: ['peer-worker', 'peer-lead'], profile: 'strict' });
});
afterEach(async () => {
  await Promise.allSettled([lead.close(), worker.close()]);
  await rm(directory, { recursive: true, force: true });
});

async function grantQueued() {
  let requestId: string | undefined;
  await vi.waitFor(async () => {
    const status = await lead.coordinate({ operation: 'status', resource });
    requestId = status.queue[0]?.requestId;
    expect(requestId).toBeDefined();
  });
  if (!requestId) throw new Error('Missing queued request');
  await lead.coordinate({ operation: 'grant', requestId });
  return requestId;
}

function markerCommand(marker: string, delay = 0) {
  return ['-e', 'require("node:fs").writeFileSync(process.argv[1], "started"); setTimeout(() => {}, Number(process.argv[2]));', marker, String(delay)];
}

describe('managed process launch gate', () => {
  it('assigns separate tickets to concurrent commands from the same run and spawns each only after its grant', async () => {
    const controller = new AbortController();
    const markers = [path.join(directory, 'first-concurrent'), path.join(directory, 'second-concurrent')] as const;
    const start = (marker: string) => withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5000 }, () => runCommand(process.execPath, markerCommand(marker), directory, { signal: controller.signal }));
    const running = [start(markers[0])];
    void running[0].catch(() => {});
    try {
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1));
      running.push(start(markers[1]));
      const finished = Promise.allSettled(running);
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(2));
      expect(markers.filter(existsSync)).toHaveLength(0);
      await grantQueued();
      await vi.waitFor(() => expect(markers.filter(existsSync)).toHaveLength(1));
      await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
      await grantQueued();
      expect((await finished).every(result => result.status === 'fulfilled')).toBe(true);
      expect(markers.filter(existsSync)).toHaveLength(2);
    } finally { controller.abort(); await Promise.allSettled(running); }
  });

  it('releases partial unused grants when a later resource wait expires', async () => {
    const other = 'machine/second-build';
    await lead.coordinate({ operation: 'set_controller', resource: other, controller: 'peer-lead', participants: ['peer-worker'], profile: 'strict' });
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 200 }, () => runCommand(process.execPath, ['-e', 'process.exit(0)'], directory));
    const rejected = expect(running).rejects.toMatchObject({ code: 'RESOURCE_WAIT_TIMEOUT' });
    await grantQueued();
    await rejected;
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
    expect((await lead.coordinate({ operation: 'status', resource: other })).queue).toEqual([]);
  });

  it('reports unresolved process ownership once and preserves the reservation for recovery', async () => {
    const probe = vi.fn(async () => 'unknown' as const);
    const uncertain = new ResourceCoordinator({ directory, principal: worker.principal, canControl: false, isPrincipalAlive: async () => true, probeProcess: probe });
    const onRecoveryRequired = vi.fn();
    try {
      const running = withCommandCoordination({ coordinator: uncertain, onRecoveryRequired, waitTimeoutMs: 5000 }, () => runCommand(process.execPath, ['-e', 'process.exit(0)'], directory));
      await grantQueued();
      await running;
      await vi.waitFor(() => expect(onRecoveryRequired).toHaveBeenCalledOnce());
      const attempts = probe.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(probe).toHaveBeenCalledTimes(attempts);
    } finally { await uncertain.close(); }
  });

  it('parks a command before spawn, shows waiting activity and resumes after a controller grant', async () => {
    const marker = path.join(directory, 'spawn-marker');
    const onWaiting = vi.fn();
    const running = withCommandCoordination({ coordinator: worker, onWaiting, waitTimeoutMs: 5_000 }, () => runCommand(process.execPath, markerCommand(marker), directory));
    await vi.waitFor(() => expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ phase: 'waiting_resource', resource })));
    expect(existsSync(marker)).toBe(false);
    await grantQueued();
    expect(await running).toMatchObject({ code: 0 });
    expect(await readFile(marker, 'utf8')).toBe('started');
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('blocks a strict-mode unknown wrapper until the hard deadline without spawning', async () => {
    const marker = path.join(directory, 'must-not-spawn');
    await expect(withCommandCoordination({ coordinator: worker, waitTimeoutMs: 20 }, () => runCommand(process.execPath, markerCommand(marker), directory))).rejects.toMatchObject({ code: 'RESOURCE_WAIT_TIMEOUT' });
    expect(existsSync(marker)).toBe(false);
  });

  it('cancels a parked command without killing or releasing the existing holder', async () => {
    const controller = new AbortController();
    const marker = path.join(directory, 'cancelled');
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 30_000 }, () => runCommand(process.execPath, markerCommand(marker), directory, { signal: controller.signal }));
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(marker)).toBe(false);
  });

  it('retains occupancy for a detached background process until actual completion', async () => {
    const marker = path.join(directory, 'background');
    const finished = vi.fn();
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5_000 }, () => runCommand(process.execPath, markerCommand(marker, 400), directory, { background: true, onBackgroundExit: finished }));
    await grantQueued();
    const result = await running;
    expect(result.backgroundPid).toBeGreaterThan(0);
    expect((await lead.coordinate({ operation: 'status', resource })).holder?.state).toBe('running');
    await vi.waitFor(() => expect(finished).toHaveBeenCalled(), { timeout: 5_000 });
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('does not release when a shell exits before a live child in the owned process group', async () => {
    const childMarker = path.join(directory, 'child-finished');
    const childCode = 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "done"), 400)';
    const code = `const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e",${JSON.stringify(childCode)},process.argv[1]],{stdio:"ignore"}); c.unref();`;
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5_000 }, () => runCommand(process.execPath, ['-e', code, childMarker], directory));
    await grantQueued();
    await running;
    if (!existsSync(childMarker)) expect((await lead.coordinate({ operation: 'status', resource })).holder).not.toBeNull();
    await vi.waitFor(() => expect(existsSync(childMarker)).toBe(true), { timeout: 5_000 });
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('cleans up a proven spawn failure without granting another command during starting', async () => {
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5_000 }, () => runCommand(path.join(directory, 'nonexistent-executable'), [], directory));
    const rejected = expect(running).rejects.toThrow(/Command not found/);
    await grantQueued();
    await rejected;
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('keeps foreground cancellation occupied until termination is confirmed', async () => {
    const controller = new AbortController();
    const marker = path.join(directory, 'foreground');
    const running = withCommandCoordination({ coordinator: worker, waitTimeoutMs: 5_000 }, () => runCommand(process.execPath, markerCommand(marker, 20_000), directory, { signal: controller.signal }));
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await grantQueued();
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true));
    controller.abort();
    await rejected;
    await vi.waitFor(async () => expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull());
  });

  it('preserves ordinary command execution outside an enrolled context', async () => {
    expect(await runCommand(process.execPath, ['-e', 'process.stdout.write("unaffected")'], directory)).toMatchObject({ stdout: 'unaffected', code: 0 });
  });
});
