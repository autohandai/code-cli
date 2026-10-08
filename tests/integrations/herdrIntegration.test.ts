/** @license Apache-2.0 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HookContext } from '../../src/core/HookManager.js';
import { attachHerdrIntegration, resolveHerdrEnvironment } from '../../src/integrations/herdr/index.js';
import {
  buildHerdrReportArgs,
  buildHerdrResumeArgv,
  HerdrReporter,
  runHerdrCommand,
  type HerdrCommandRunner,
} from '../../src/integrations/herdr/reporter.js';
import {
  deriveHerdrTransition,
  INITIAL_HERDR_PANE_STATE,
  sanitizeHerdrMessage,
  type HerdrPaneState,
  type HerdrReport,
} from '../../src/integrations/herdr/stateMachine.js';

const HERDR_ENV = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p3', HERDR_BIN_PATH: '/opt/herdr/bin/herdr' };
const environment = { binPath: HERDR_ENV.HERDR_BIN_PATH, paneId: HERDR_ENV.HERDR_PANE_ID };

function event(context: Partial<HookContext> & { event: HookContext['event'] }): HookContext {
  return { workspace: '/work', ...context };
}

function run(previous: HerdrPaneState, ...contexts: HookContext[]): { state: HerdrPaneState; reports: HerdrReport[] } {
  const reports: HerdrReport[] = [];
  let state = previous;
  for (const context of contexts) {
    const transition = deriveHerdrTransition(state, context);
    state = transition.next;
    if (transition.report) reports.push(transition.report);
  }
  return { state, reports };
}

describe('resolveHerdrEnvironment', () => {
  it('reads the pane and binary Herdr injects', () => {
    expect(resolveHerdrEnvironment(HERDR_ENV)).toEqual(environment);
  });

  it.each([
    ['HERDR_ENV missing', { ...HERDR_ENV, HERDR_ENV: undefined }],
    ['HERDR_ENV not 1', { ...HERDR_ENV, HERDR_ENV: 'true' }],
    ['pane missing', { ...HERDR_ENV, HERDR_PANE_ID: '' }],
    ['binary missing', { ...HERDR_ENV, HERDR_BIN_PATH: '  ' }],
  ])('stays silent when %s', (_label, env) => {
    expect(resolveHerdrEnvironment(env)).toBeNull();
  });
});

describe('deriveHerdrTransition', () => {
  it('reports idle with the session on session-start', () => {
    const { state, reports } = run(INITIAL_HERDR_PANE_STATE, event({ event: 'session-start', sessionId: 's-1', sessionType: 'startup' }));
    expect(reports).toEqual([{ kind: 'state', state: 'idle', sessionId: 's-1', message: null }]);
    expect(state.sessionId).toBe('s-1');
  });

  it('walks a turn through working, blocked, working, and idle', () => {
    const start: HerdrPaneState = { state: 'idle', sessionId: 's-1', message: null };
    const { reports } = run(
      start,
      event({ event: 'pre-prompt', instruction: 'ship it' }),
      event({ event: 'pre-tool', tool: 'read_file' }),
      event({ event: 'permission-request', tool: 'run_command', command: 'rm -rf dist', permissionType: 'tool_approval' }),
      event({ event: 'post-tool', tool: 'run_command', success: true }),
      event({ event: 'stop', turnDuration: 10 }),
    );
    expect(reports.map((report) => (report.kind === 'state' ? [report.state, report.message] : ['release', null]))).toEqual([
      ['working', null],
      ['blocked', 'needs approval: rm -rf dist'],
      ['working', null],
      ['idle', null],
    ]);
    expect(reports.every((report) => report.kind === 'state' && report.sessionId === 's-1')).toBe(true);
  });

  it('marks a pending question as blocked and the answer as working', () => {
    const start: HerdrPaneState = { state: 'working', sessionId: 's-1', message: null };
    const { reports } = run(
      start,
      event({ event: 'pre-tool', tool: 'ask_followup_question' }),
      event({ event: 'post-tool', tool: 'ask_followup_question', success: true }),
    );
    expect(reports).toEqual([
      { kind: 'state', state: 'blocked', sessionId: 's-1', message: 'waiting for your answer' },
      { kind: 'state', state: 'working', sessionId: 's-1', message: null },
    ]);
  });

  it('does not repeat an unchanged state', () => {
    const start: HerdrPaneState = { state: 'working', sessionId: 's-1', message: null };
    const { reports } = run(start, event({ event: 'pre-tool', tool: 'read_file' }), event({ event: 'post-tool', tool: 'read_file' }));
    expect(reports).toEqual([]);
  });

  it('ignores events that are not turn progress while idle', () => {
    const start: HerdrPaneState = { state: 'idle', sessionId: 's-1', message: null };
    const { reports } = run(start, event({ event: 'mode-change', mode: 'yolo' }), event({ event: 'notification' }), event({ event: 'post-tool', tool: 'x' }));
    expect(reports).toEqual([]);
  });

  it.each(['rate-limit', 'session-error'] as const)('returns to idle when the turn ends with %s', (name) => {
    const start: HerdrPaneState = { state: 'blocked', sessionId: 's-1', message: 'needs approval' };
    const { reports } = run(start, event({ event: name, error: 'boom' }));
    expect(reports).toEqual([{ kind: 'state', state: 'idle', sessionId: 's-1', message: null }]);
  });

  it('releases the pane when the session ends for good', () => {
    const start: HerdrPaneState = { state: 'idle', sessionId: 's-1', message: null };
    const { state, reports } = run(start, event({ event: 'session-end', sessionId: 's-1', sessionEndReason: 'quit' }));
    expect(reports).toEqual([{ kind: 'release' }]);
    expect(state).toEqual(INITIAL_HERDR_PANE_STATE);
  });

  it('keeps the pane through /new and reports the replacement session', () => {
    const start: HerdrPaneState = { state: 'idle', sessionId: 's-1', message: null };
    const { reports } = run(
      start,
      event({ event: 'session-end', sessionId: 's-1', sessionEndReason: 'clear' }),
      event({ event: 'session-start', sessionId: 's-2', sessionType: 'clear' }),
    );
    expect(reports).toEqual([{ kind: 'state', state: 'idle', sessionId: 's-2', message: null }]);
  });

  it('keeps blocked messages to one short line', () => {
    expect(sanitizeHerdrMessage('a\n\tb\u0007  c')).toBe('a b c');
    expect(sanitizeHerdrMessage('x'.repeat(300))).toHaveLength(120);
  });
});

describe('buildHerdrReportArgs', () => {
  it('builds a state report with the session and resume command', () => {
    const args = buildHerdrReportArgs({ kind: 'state', state: 'blocked', sessionId: 'abc-123', message: 'needs approval: rm' }, 'w1:p3', 7);
    expect(args).toEqual([
      'pane', 'report-agent', 'w1:p3',
      '--source', 'autohand-code', '--agent', 'autohand', '--seq', '7',
      '--state', 'blocked', '--message', 'needs approval: rm',
      '--agent-session-id', 'abc-123',
      '--', 'autohand', 'resume', 'abc-123',
    ]);
  });

  it('builds a release report', () => {
    expect(buildHerdrReportArgs({ kind: 'release' }, 'w1:p3', 8)).toEqual([
      'pane', 'release-agent', 'w1:p3', '--source', 'autohand-code', '--agent', 'autohand', '--seq', '8',
    ]);
  });

  it('omits the session and resume command when there is no session yet', () => {
    const args = buildHerdrReportArgs({ kind: 'state', state: 'working', sessionId: null, message: null }, 'w1:p3', 9);
    expect(args).not.toContain('--agent-session-id');
    expect(args).not.toContain('--');
  });

  it('never sends a resume command Herdr would reject', () => {
    expect(buildHerdrResumeArgv("it's")).toBeNull();
    expect(buildHerdrResumeArgv('bad\u0001id')).toBeNull();
    expect(buildHerdrResumeArgv('-leading')).toBeNull();
    expect(buildHerdrResumeArgv('01HZX.session:2')).toEqual(['autohand', 'resume', '01HZX.session:2']);
  });
});

describe('HerdrReporter', () => {
  function deferredRunner(): { run: HerdrCommandRunner; calls: string[][]; release: () => void } {
    const calls: string[][] = [];
    const resolvers: Array<() => void> = [];
    const run: HerdrCommandRunner = (_bin, args) => {
      calls.push([...args]);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    return { run, calls, release: () => resolvers.shift()?.() };
  }

  it('keeps one call in flight and drops superseded reports', async () => {
    const { run, calls, release } = deferredRunner();
    let clock = 1_000;
    const reporter = new HerdrReporter({ environment, run, now: () => clock });
    reporter.report({ kind: 'state', state: 'working', sessionId: 's', message: null });
    clock = 1_000;
    reporter.report({ kind: 'state', state: 'blocked', sessionId: 's', message: 'needs approval' });
    reporter.report({ kind: 'state', state: 'idle', sessionId: 's', message: null });
    expect(calls).toHaveLength(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('idle');
    expect(calls[1]).not.toContain('blocked');
    release();
    await reporter.settled();
  });

  it('issues strictly increasing sequence numbers even when the clock stalls', async () => {
    const calls: string[][] = [];
    const run: HerdrCommandRunner = async (_bin, args) => {
      calls.push([...args]);
    };
    const reporter = new HerdrReporter({ environment, run, now: () => 5_000 });
    for (const state of ['working', 'idle', 'working'] as const) {
      reporter.report({ kind: 'state', state, sessionId: null, message: null });
      await reporter.settled();
    }
    const seqs = calls.map((args) => Number(args[args.indexOf('--seq') + 1]));
    expect(seqs).toEqual([5_000, 5_001, 5_002]);
  });

  it('survives a runner failure', async () => {
    const run: HerdrCommandRunner = () => Promise.reject(new Error('no socket'));
    const reporter = new HerdrReporter({ environment, run });
    reporter.report({ kind: 'release' });
    await expect(reporter.settled()).resolves.toBeUndefined();
  });
});

describe('runHerdrCommand', () => {
  it.skipIf(process.platform === 'win32')('spawns the Herdr binary with the report arguments', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'herdr-'));
    const log = path.join(dir, 'calls.log');
    const bin = path.join(dir, 'herdr');
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${log}"\n`);
    chmodSync(bin, 0o755);

    await runHerdrCommand(bin, ['pane', 'report-agent', 'w1:p1', '--state', 'working']);

    expect(readFileSync(log, 'utf8').split('\n').filter(Boolean)).toEqual(['pane', 'report-agent', 'w1:p1', '--state', 'working']);
  });

  it('resolves when the binary does not exist', async () => {
    await expect(runHerdrCommand('/definitely/missing/herdr', ['pane'])).resolves.toBeUndefined();
  });
});

describe('attachHerdrIntegration', () => {
  function lifecycle() {
    const listeners = new Set<(context: Readonly<HookContext>) => void>();
    return {
      hookManager: {
        subscribeLifecycle: vi.fn((listener: (context: Readonly<HookContext>) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
      },
      emit: (context: HookContext) => listeners.forEach((listener) => listener(context)),
      size: () => listeners.size,
    };
  }

  it('does nothing outside Herdr', () => {
    const source = lifecycle();
    expect(attachHerdrIntegration({ hookManager: source.hookManager, env: {} })).toBeNull();
    expect(source.hookManager.subscribeLifecycle).not.toHaveBeenCalled();
  });

  it('reports lifecycle events to the owning pane and can detach', async () => {
    const source = lifecycle();
    const calls: Array<{ bin: string; args: string[] }> = [];
    const run: HerdrCommandRunner = async (bin, args) => {
      calls.push({ bin, args: [...args] });
    };
    const integration = attachHerdrIntegration({ hookManager: source.hookManager, env: HERDR_ENV, run, now: () => 42 });
    expect(integration).not.toBeNull();

    source.emit(event({ event: 'session-start', sessionId: 'sess', sessionType: 'startup' }));
    await integration!.reporter.settled();
    source.emit(event({ event: 'pre-prompt' }));
    await integration!.reporter.settled();
    source.emit(event({ event: 'session-end', sessionId: 'sess', sessionEndReason: 'exit' }));
    await integration!.reporter.settled();

    expect(calls.map((call) => call.bin)).toEqual([environment.binPath, environment.binPath, environment.binPath]);
    expect(calls[0].args).toEqual(expect.arrayContaining(['report-agent', 'w1:p3', '--state', 'idle', '--agent-session-id', 'sess', 'resume', 'sess']));
    expect(calls[1].args).toEqual(expect.arrayContaining(['--state', 'working']));
    expect(calls[2].args).toEqual(expect.arrayContaining(['release-agent', 'w1:p3']));

    integration!.detach();
    expect(source.size()).toBe(0);
  });
});
