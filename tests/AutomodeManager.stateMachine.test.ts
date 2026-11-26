import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  AUTOMODE_LIFECYCLE,
  AutomodeManager,
  type AutomodeLifecycleEvent,
  type IterationCallback,
} from '../src/core/AutomodeManager.js';
import { AUTOMODE_STATUS_TRANSITIONS, AutomodeState } from '../src/core/AutomodeState.js';
import type { Session } from '../src/session/SessionManager.js';
import type { SessionMessage } from '../src/session/types.js';
import type { AutomodeStatus, LoadedConfig } from '../src/types.js';
import { StateMachine, reachableStates, terminalStates } from '../src/utils/stateMachine.js';
import { randomEventWalk } from './helpers/stateMachineProperties.js';

const LIFECYCLE_EVENTS: readonly AutomodeLifecycleEvent[] = [
  'start', 'abandon', 'begin', 'pause', 'resume', 'cancel', 'complete', 'fail', 'settle',
];
const STATUSES: readonly AutomodeStatus[] = ['running', 'paused', 'completed', 'cancelled', 'failed'];

describe('AUTOMODE_LIFECYCLE transition table', () => {
  const next = (from: keyof typeof AUTOMODE_LIFECYCLE.transitions, event: AutomodeLifecycleEvent) =>
    new StateMachine(AUTOMODE_LIFECYCLE, { initial: from }).trySend(event);

  it('allows the documented run lifecycle', () => {
    const machine = new StateMachine(AUTOMODE_LIFECYCLE);
    for (const event of ['start', 'begin', 'pause', 'resume', 'complete', 'settle'] as const) machine.send(event);
    expect(machine.state).toBe('idle');
    expect(next('starting', 'abandon')).toBe(true);
    expect(next('starting', 'cancel')).toBe(true);
    expect(next('paused', 'cancel')).toBe(true);
    expect(next('paused', 'complete')).toBe(true);
    expect(next('running', 'fail')).toBe(true);
  });

  it('never lets a run outcome be overwritten', () => {
    for (const outcome of ['cancelled', 'completed', 'failed'] as const) {
      expect(Object.keys(AUTOMODE_LIFECYCLE.transitions[outcome])).toEqual(['settle']);
    }
    expect(next('cancelled', 'complete')).toBe(false);
    expect(next('cancelled', 'cancel')).toBe(false);
    expect(next('cancelled', 'pause')).toBe(false);
    expect(next('cancelled', 'fail')).toBe(false);
    expect(next('completed', 'cancel')).toBe(false);
    expect(next('idle', 'cancel')).toBe(false);
    expect(next('idle', 'pause')).toBe(false);
    expect(next('running', 'start')).toBe(false);
    expect(next('starting', 'complete')).toBe(false);
  });

  it('reaches every state and always returns to idle (reusable manager)', () => {
    expect(reachableStates(AUTOMODE_LIFECYCLE)).toEqual(new Set(Object.keys(AUTOMODE_LIFECYCLE.transitions)));
    expect(terminalStates(AUTOMODE_LIFECYCLE)).toEqual([]);
  });

  it('accepts exactly the declared edges for random event sequences', () => {
    randomEventWalk(AUTOMODE_LIFECYCLE, LIFECYCLE_EVENTS, { seeds: 50, steps: 60 });
  });
});

describe('AUTOMODE_STATUS_TRANSITIONS transition table', () => {
  it('treats cancelled, completed and failed as final persisted statuses', () => {
    expect(terminalStates(AUTOMODE_STATUS_TRANSITIONS).sort()).toEqual(['cancelled', 'completed', 'failed']);
    expect(reachableStates(AUTOMODE_STATUS_TRANSITIONS)).toEqual(new Set(STATUSES));
  });

  it('accepts exactly the declared edges for random status sequences', () => {
    randomEventWalk(AUTOMODE_STATUS_TRANSITIONS, STATUSES, { seeds: 50, steps: 40 });
  });
});

describe('AutomodeState.setStatus guards', () => {
  let root: string;
  let state: AutomodeState;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automode-status-machine-'));
    state = new AutomodeState(path.join(root, 'workspace'), path.join(root, 'private'));
    await state.initialize({ sessionId: 'run', prompt: 'Task', maxIterations: 3, completionPromise: 'DONE' });
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('moves between running and paused', async () => {
    expect(await state.setStatus('paused')).toBe(true);
    expect(await state.setStatus('running')).toBe(true);
    expect(state.getState()?.status).toBe('running');
  });

  it('refuses to reopen or rewrite a finished run, in memory and on disk', async () => {
    expect(await state.setStatus('cancelled', 'user_escape')).toBe(true);
    expect(await state.setStatus('running')).toBe(false);
    expect(await state.setStatus('paused')).toBe(false);
    expect(await state.setStatus('completed', 'completion')).toBe(false);
    expect(await state.setStatus('cancelled', 'circuit_breaker')).toBe(false);
    expect(state.getState()).toMatchObject({ status: 'cancelled', cancelReason: 'user_escape' });
    const saved = await fs.readFile(state.getStatePath(), 'utf8');
    expect(saved).toContain('**Status:** cancelled');
    expect(saved).toContain('**Cancel Reason:** user_escape');
  });

  it('loads an older file with an unknown status without throwing and still lets it be closed', async () => {
    const file = state.getStatePath();
    const content = (await fs.readFile(file, 'utf8')).replace('**Status:** running', '**Status:** archived');
    await fs.writeFile(file, content);
    expect((await state.load())?.status).toBe('archived');
    expect(await state.setStatus('cancelled', 'error')).toBe(true);
    expect(state.getState()?.status).toBe('cancelled');
  });

  it('loads a paused file and resumes it', async () => {
    await state.setStatus('paused');
    expect((await state.load())?.status).toBe('paused');
    expect(await state.setStatus('running')).toBe(true);
  });
});

describe('AutomodeManager lifecycle', () => {
  let root: string;
  let events: Array<{ event: string; context: Record<string, unknown> }>;
  let entries: SessionMessage[];
  let manager: AutomodeManager;

  const config: LoadedConfig = {
    configPath: '/unused/config.json',
    provider: 'openrouter',
    openrouter: { apiKey: 'fixture', model: 'fixture' },
    automode: { noProgressThreshold: 1 },
  };

  const fakeSession = (append: (message: SessionMessage) => Promise<void>) =>
    ({ append } as unknown as Session);

  const options = { prompt: 'Fixture task', useWorktree: false, maxIterations: 3 };
  const named = (name: string) => events.filter(item => item.event === name);
  const cancelEntries = () => entries.filter(entry => entry.content.startsWith('[Auto-Mode Cancelled]'));

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automode-lifecycle-'));
    await fs.ensureDir(path.join(root, 'workspace'));
    vi.stubEnv('AUTOHAND_HOME', path.join(root, 'home'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events = [];
    entries = [];
    manager = new AutomodeManager(
      config,
      path.join(root, 'workspace'),
      undefined,
      fakeSession(async message => { entries.push(message); }),
    );
    for (const name of ['automode:start', 'automode:cancel', 'automode:complete', 'automode:pause', 'automode:resume', 'automode:error']) {
      manager.on(name, (context: Record<string, unknown>) => events.push({ event: name, context }));
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.remove(root);
  });

  it('rejects a second start issued before the first one reaches its first await', async () => {
    const iterate = vi.fn<IterationCallback>(async () => ({ success: true, actions: ['write'], filesCreated: 1, output: 'DONE' }));
    const first = manager.start(options, iterate);
    const second = manager.start(options, iterate);
    await expect(second).rejects.toThrow('Auto-mode is already running');
    await first;
    expect(iterate).toHaveBeenCalledTimes(1);
    expect(named('automode:start')).toHaveLength(1);
  });

  it('keeps a cancellation made during an iteration instead of completing', async () => {
    await manager.start(options, async () => {
      await manager.cancel('user_escape');
      return { success: true, actions: ['write'], filesCreated: 1, output: '<promise>DONE</promise>' };
    });
    expect(manager.getState()).toMatchObject({ status: 'cancelled', cancelReason: 'user_escape', currentIteration: 1 });
    expect(named('automode:complete')).toHaveLength(0);
    expect(named('automode:cancel')).toHaveLength(1);
  });

  it('ignores pause and resume once the run is cancelled', async () => {
    await manager.start(options, async () => {
      await manager.cancel('user_escape');
      await manager.pause();
      expect(manager.isPausedState()).toBe(false);
      await manager.resume();
      return { success: true, actions: ['write'], filesCreated: 1 };
    });
    expect(manager.getState()?.status).toBe('cancelled');
    expect(named('automode:pause')).toHaveLength(0);
    expect(named('automode:resume')).toHaveLength(0);
  });

  it('records one cancellation when the circuit breaker fires after a user cancel', async () => {
    await manager.start(options, async () => {
      await manager.cancel('user_escape');
      return { success: true, actions: ['read'], filesCreated: 0 };
    });
    expect(named('automode:cancel')).toHaveLength(1);
    expect(named('automode:cancel')[0]?.context.automodeCancelReason).toBe('user_escape');
    expect(cancelEntries()).toHaveLength(1);
    expect(manager.getState()?.cancelReason).toBe('user_escape');
  });

  it('records one cancellation when cancel is called twice concurrently', async () => {
    await manager.start(options, async () => {
      await Promise.all([manager.cancel('user_escape'), manager.cancel('hook_cancel')]);
      return { success: true, actions: ['write'], filesCreated: 1 };
    });
    expect(named('automode:cancel')).toHaveLength(1);
    expect(cancelEntries()).toHaveLength(1);
    expect(manager.getState()?.cancelReason).toBe('user_escape');
  });

  it('honours a cancel issued while the run is still starting', async () => {
    const iterate = vi.fn<IterationCallback>(async () => ({ success: true, actions: ['write'], filesCreated: 1 }));
    const run = manager.start(options, iterate);
    expect(manager.isActive()).toBe(true);
    await manager.cancel('user_escape');
    await run;
    expect(iterate).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({ status: 'cancelled', cancelReason: 'user_escape' });
    expect(named('automode:start')).toHaveLength(1);
    expect(named('automode:cancel')).toHaveLength(1);
    expect(named('automode:cancel')[0]?.context.automodeSessionId).toBe(manager.getState()?.sessionId);
    expect(manager.isActive()).toBe(false);
  });

  it('keeps the cancellation when the iteration throws after the user cancelled', async () => {
    await manager.start(options, async () => {
      await manager.cancel('user_escape');
      throw new Error('aborted fetch');
    });
    expect(manager.getState()).toMatchObject({ status: 'cancelled', cancelReason: 'user_escape' });
    expect(manager.isActive()).toBe(false);
  });

  it('does not stay active forever when setup fails before the loop', async () => {
    const failing = new AutomodeManager(config, path.join(root, 'workspace'), undefined, fakeSession(async () => {
      throw new Error('session store offline');
    }));
    await failing.start(options, async () => ({ success: true, actions: [] }));
    expect(failing.isActive()).toBe(false);
    expect(failing.getState()).toMatchObject({ status: 'failed', errorMessage: 'Error: session store offline' });
  });

  it('can run again after a run finishes', async () => {
    const done: IterationCallback = async () => ({ success: true, actions: ['write'], filesCreated: 1, output: 'DONE' });
    await manager.start(options, done);
    expect(manager.isActive()).toBe(false);
    await manager.start(options, done);
    expect(manager.getState()?.status).toBe('completed');
    expect(named('automode:start')).toHaveLength(2);
  });

  it('reports paused only while paused and active throughout the run', async () => {
    const observed: Array<[boolean, boolean]> = [];
    await manager.start({ ...options, maxIterations: 1 }, async () => {
      observed.push([manager.isActive(), manager.isPausedState()]);
      await manager.pause();
      observed.push([manager.isActive(), manager.isPausedState()]);
      return { success: true, actions: ['write'], filesCreated: 1, output: 'DONE' };
    });
    expect(observed).toEqual([[true, false], [true, true]]);
    expect(manager.getState()?.status).toBe('completed');
    expect([manager.isActive(), manager.isPausedState()]).toEqual([false, false]);
  });
});
