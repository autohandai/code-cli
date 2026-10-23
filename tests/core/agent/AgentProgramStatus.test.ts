import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentProgramStatus,
  formatProgramStatus,
  shouldWriteProgramStatus,
  withProgramStatusWait,
  type ProgramStatusReport,
} from '../../../src/core/agent/AgentProgramStatus.js';

const controllers: AgentProgramStatus[] = [];
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose());
  vi.useRealTimers();
});

describe('OSC7501 program status', () => {
  it('encodes every state with ST termination and repeats the record identity', () => {
    for (const state of ['idle', 'working', 'done', 'error', 'clear'] as const) {
      expect(formatProgramStatus({ state, id: 'autohand-1', app: 'autohand' }))
        .toBe(`\x1b]7501;state=${state}:id=autohand-1:app=autohand\x1b\\`);
    }
    expect(formatProgramStatus({ state: 'blocked', kind: 'permission', app: 'autohand', message: 'Approve: deploy?' }))
      .toBe('\x1b]7501;state=blocked:app=autohand:kind=permission:msg=QXBwcm92ZTogZGVwbG95Pw==\x1b\\');
  });

  it('sanitizes C0, DEL and C1 controls and bounds UTF-8 text without splitting a code point', () => {
    const sequence = formatProgramStatus({ state: 'working', progress: 42,
      title: '🦜'.repeat(100), message: 'a\x1b\x07\n\t\x7f\x85b' + '🦜'.repeat(1000) });
    const title = sequence.match(/title=([^:]+)/)?.[1] ?? '';
    const message = sequence.match(/msg=([^\x1b]+)/)?.[1] ?? '';
    expect(Buffer.from(title, 'base64').length).toBeLessThanOrEqual(192);
    expect(Buffer.from(message, 'base64').length).toBeLessThanOrEqual(2048);
    expect(Buffer.from(message, 'base64').toString('utf8')).not.toMatch(/[\x00-\x1f\x7f-\x9f\ufffd]/);
    expect(sequence).toContain(':progress=42');
    expect(Buffer.byteLength(sequence)).toBeLessThanOrEqual(4096);
  });

  it('rejects malformed identifiers and out-of-range progress', () => {
    expect(() => formatProgramStatus({ state: 'idle', id: 'bad:id' })).toThrow();
    expect(() => formatProgramStatus({ state: 'idle', app: 'bad app' })).toThrow();
    for (const progress of [-1, 101, 1.5, NaN, Infinity]) {
      expect(() => formatProgramStatus({ state: 'working', progress })).toThrow();
    }
  });

  it.each([
    ['--json'], ['--json=local'], ['--output-format', 'text'], ['--output-format=stream-json'],
    ['--mode', 'rpc'], ['--mode=rpc'], ['--acp'], ['--mode=acp'], ['--mode', 'acp'],
    ['--mode', 'teammate'], ['--mode=teammate'],
    ['--answer-only'], ['--setup-only'], ['-p', 'hello'], ['-phello'], ['--prompt=hello'],
  ])('keeps %j output free of OSC7501 even on a TTY', (...args) => {
    expect(shouldWriteProgramStatus(args, true)).toBe(false);
  });

  it('requires interactive terminal output', () => {
    expect(shouldWriteProgramStatus([], true)).toBe(true);
    expect(shouldWriteProgramStatus([], false)).toBe(false);
    expect(shouldWriteProgramStatus([], undefined)).toBe(false);
  });
});

describe('agent program status lifecycle', () => {
  function harness(enabled = true) {
    const write = vi.fn();
    const reports: ProgramStatusReport[] = [];
    const status = new AgentProgramStatus({ id: 'autohand-1', enabled, write,
      onChange: report => reports.push(report) });
    controllers.push(status);
    return { status, write, reports, states: () => reports.map(report => report.state) };
  }

  it('reports startup, work, each blocked kind, resumption, completion and scoped exit cleanup', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const { status, write, reports, states } = harness();
    status.start();
    await status.run(async () => {
      for (const kind of ['permission', 'question', 'auth'] as const) {
        await withProgramStatusWait(kind, 'Waiting for input', async () => 'answer');
      }
      return true;
    });
    status.dispose();
    status.dispose();
    expect(states()).toEqual(['idle', 'working', 'blocked', 'working', 'blocked', 'working', 'blocked', 'working', 'done', 'clear']);
    expect(reports.filter(report => report.state === 'blocked').map(report => report.kind)).toEqual(['permission', 'question', 'auth']);
    expect(write.mock.calls.at(-1)?.[0]).toContain('state=clear:id=autohand-1');
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('restores the previous state after a prompt outside a turn and nested prompts', async () => {
    const { status, states } = harness();
    status.start();
    await status.wait('auth', 'Sign in', async () => {
      await status.wait('question', 'Choose account', async () => undefined);
    });
    expect(states()).toEqual(['idle', 'blocked', 'blocked', 'blocked', 'idle']);
  });

  it('preserves errors until the next operation and reports cancellation as idle', async () => {
    const { status, states } = harness();
    await expect(status.run(async () => { throw new Error('provider failed'); })).rejects.toThrow('provider failed');
    expect(states()).toEqual(['working', 'error']);
    const abort = new AbortController();
    await status.run(async () => { abort.abort(); return false; }, { signal: abort.signal });
    expect(states()).toEqual(['working', 'error', 'working', 'idle']);
    await status.run(async () => false);
    expect(states().at(-1)).toBe('error');
  });

  it('does not report done while an outer operation is still running', async () => {
    const { status, states } = harness();
    await status.run(async () => {
      await status.run(async () => true);
      expect(states()).toEqual(['working']);
      return true;
    });
    expect(states()).toEqual(['working', 'done']);
  });

  it('reports an internal Escape cancellation as idle even when the admission signal is live', async () => {
    const { status, states } = harness();
    await status.run(async () => { status.cancel(); return false; });
    expect(states()).toEqual(['working', 'idle']);
  });

  it('keeps an explicit authentication failure after a command returns its legacy null result', async () => {
    const { status, states } = harness();
    await status.run(() => status.wait('auth', 'Sign in', async () => { status.fail('Authorization expired'); return null; }));
    expect(states()).toEqual(['working', 'blocked', 'error']);
  });

  it('keeps an explicit permission/auth kind while a generic modal is mounted', async () => {
    const { status, reports } = harness();
    await status.run(async () => status.wait('permission', 'Approve a tool', async () => {
      await status.prompt('Choose an option', async () => true);
    }));
    expect(reports.filter(report => report.state === 'blocked')).toEqual([
      expect.objectContaining({ kind: 'permission', message: 'Approve a tool' }),
    ]);
  });

  it('releases the synchronous process-exit cleanup listener on dispose', () => {
    const baseline = process.listenerCount('exit');
    const { status } = harness();
    status.start();
    expect(process.listenerCount('exit')).toBe(baseline + 1);
    status.dispose();
    expect(process.listenerCount('exit')).toBe(baseline);
  });

  it('writes only the synchronous clear sequence during process exit', () => {
    const before = new Set(process.listeners('exit'));
    const { status, write, reports } = harness();
    status.start();
    const onExit = process.listeners('exit').find(listener => !before.has(listener));
    expect(onExit).toBeDefined();
    onExit?.(0);
    expect(write.mock.calls.at(-1)?.[0]).toContain('state=clear');
    expect(reports.map(report => report.state)).toEqual(['idle']);
  });

  it('does not let late operations restore cleared records', async () => {
    const { status, states } = harness();
    await status.run(async () => {
      await status.wait('permission', 'Approve', async () => status.dispose());
      return true;
    });
    expect(states()).toEqual(['working', 'blocked', 'clear']);
  });

  it('isolates concurrent sessions and keeps structured observers active without writing escapes', async () => {
    const first = harness(false);
    const second = harness(false);
    await Promise.all([
      first.status.run(async () => withProgramStatusWait('permission', 'First', async () => true)),
      second.status.run(async () => withProgramStatusWait('question', 'Second', async () => true)),
    ]);
    expect(first.reports.find(report => report.state === 'blocked')).toMatchObject({ kind: 'permission' });
    expect(second.reports.find(report => report.state === 'blocked')).toMatchObject({ kind: 'question' });
    expect(first.write).not.toHaveBeenCalled();
    expect(second.write).not.toHaveBeenCalled();
  });

  it('keeps status write and observer failures from changing the operation result', async () => {
    const status = new AgentProgramStatus({ id: 'autohand-1', enabled: true,
      write: () => { throw new Error('closed terminal'); },
      onChange: () => { throw new Error('observer failed'); } });
    expect(await status.run(async () => true)).toBe(true);
    status.dispose();
  });
});
