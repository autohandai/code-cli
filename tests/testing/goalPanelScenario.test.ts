import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as scenarios from '../../src/testing/scenarios/goalPanelScenario.js';

const fixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: fixture.spawn,
  execFile: vi.fn(() => { throw new Error('Expected a phase-aware goal fixture.'); }),
}));

const READY = '__AUTOHAND_GOAL_READY__';
const DONE = '__AUTOHAND_GOAL_DONE__';
let child: ChildProcess;
let result: Promise<unknown> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  child = new ChildProcess();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  vi.spyOn(child, 'kill').mockImplementation(signal => {
    child.emit('close', null, signal);
    return true;
  });
  fixture.spawn.mockReturnValue(child);
});

afterEach(async () => {
  try {
    child.emit('close', null, 'SIGKILL');
    await result?.catch(() => undefined);
    child.stdout?.destroy();
    child.stderr?.destroy();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    result = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

function start(observe = false): Promise<unknown> {
  result = observe
    ? scenarios.observeGoalFromAnotherProcess('/fixture')
    : scenarios.enqueueGoalFromAnotherProcess('/fixture', 'fixture objective');
  void result.catch(() => undefined);
  return result;
}

async function output(text: string): Promise<void> {
  (child.stdout as PassThrough).write(text);
  await vi.advanceTimersByTimeAsync(0);
}

describe('goal fixture process phases', () => {
  it('gives imported code its full operation budget after a slow bootstrap', async () => {
    const pending = start();
    await vi.advanceTimersByTimeAsync(29_000);
    await output(`${READY}\n`);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).not.toHaveBeenCalled();
    await output(`${DONE}\n`);
    child.emit('close', 0, null);
    await expect(pending).resolves.toBeUndefined();
  });

  it('bounds bootstrap before any readiness marker', async () => {
    const assertion = expect(start()).rejects.toThrow(/bootstrap.*30000/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('retains the 15-second operation deadline after readiness', async () => {
    const assertion = expect(start()).rejects.toThrow(/operation.*15000/);
    await output(`${READY}\n`);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('rejects a subscription that retains a referenced handle after observing state', async () => {
    const assertion = expect(start(true)).rejects.toThrow(/exit.*1000/);
    await output(`${READY}\nOBSERVED\n`);
    await vi.advanceTimersByTimeAsync(999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('accepts split and coalesced markers followed by natural code-zero exit', async () => {
    const pending = start(true);
    await output(READY.slice(0, 10));
    await output(`${READY.slice(10)}\nOBSERVED\n`);
    child.emit('close', 0, null);
    await expect(pending).resolves.toContain('OBSERVED');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects an early successful exit without completing the operation', async () => {
    const assertion = expect(start()).rejects.toThrow(/operation.*completion/i);
    await output(`${READY}\n`);
    child.emit('close', 0, null);
    await assertion;
  });

  it('requires readiness even when a child exits successfully', async () => {
    const assertion = expect(start()).rejects.toThrow(/bootstrap.*readiness/i);
    child.emit('close', 0, null);
    await assertion;
  });

  it('retains bounded diagnostic tails on nonzero exit', async () => {
    const assertion = expect(start()).rejects.toMatchObject({ message: expect.stringMatching(/bootstrap.*code 7/) });
    (child.stderr as PassThrough).write('x'.repeat(40_000));
    await vi.advanceTimersByTimeAsync(0);
    child.emit('close', 7, null);
    await assertion;
    await result?.catch(error => expect(String(error).length).toBeLessThan(17_000));
  });

  it('reports spawn failures and releases its watchdog', async () => {
    const assertion = expect(start()).rejects.toThrow(/fixture launch failed/);
    child.emit('error', new Error('fixture launch failed'));
    child.emit('close', null, null);
    await assertion;
  });
});
