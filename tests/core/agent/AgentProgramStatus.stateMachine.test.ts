import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROGRAM_STATUS_LIFECYCLE,
  AgentProgramStatus,
  type ProgramStatusReport,
} from '../../../src/core/agent/AgentProgramStatus.js';
import { reachableStates, StateMachine, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

describe('AGENT_PROGRAM_STATUS_LIFECYCLE transition table', () => {
  const events = ['begin', 'fail', 'cancel', 'settle', 'dispose'] as const;

  it('declares the activity-period edges with cancellation dominating failure', () => {
    expect(AGENT_PROGRAM_STATUS_LIFECYCLE.initial).toBe('settled');
    expect(AGENT_PROGRAM_STATUS_LIFECYCLE.transitions).toEqual({
      settled: { begin: 'running', fail: 'settled', cancel: 'settled', dispose: 'disposed' },
      running: { fail: 'failing', cancel: 'cancelling', settle: 'settled', dispose: 'disposed' },
      failing: { fail: 'failing', cancel: 'cancelling', settle: 'settled', dispose: 'disposed' },
      cancelling: { fail: 'cancelling', cancel: 'cancelling', settle: 'settled', dispose: 'disposed' },
      disposed: {},
    });
  });

  it('rejects settling without a run and beginning twice in one activity period', () => {
    const machine = new StateMachine(AGENT_PROGRAM_STATUS_LIFECYCLE);
    expect(machine.can('settle')).toBe(false);
    machine.send('begin');
    expect(machine.can('begin')).toBe(false);
  });

  it('has disposed as its only terminal state and reaches every state', () => {
    expect(terminalStates(AGENT_PROGRAM_STATUS_LIFECYCLE)).toEqual(['disposed']);
    expect(reachableStates(AGENT_PROGRAM_STATUS_LIFECYCLE))
      .toEqual(new Set(Object.keys(AGENT_PROGRAM_STATUS_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(AGENT_PROGRAM_STATUS_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('AgentProgramStatus overlapping runs', () => {
  const controllers: AgentProgramStatus[] = [];
  afterEach(() => controllers.splice(0).forEach(controller => controller.dispose()));

  function harness() {
    const write = vi.fn();
    const reports: ProgramStatusReport[] = [];
    const status = new AgentProgramStatus({ id: 'autohand-1', enabled: true, write, onChange: report => reports.push(report) });
    controllers.push(status);
    return { status, write, reports };
  }

  it('keeps an explicit failure when a nested run starts after it instead of ending on working', async () => {
    const { status, reports } = harness();
    await status.run(async () => {
      status.fail('Authorization expired');
      await status.run(async () => true);
      return false;
    });
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: 'Authorization expired' });
  });

  it('restores the outer run message after a nested run finishes', async () => {
    const { status, reports } = harness();
    await status.run(async () => {
      await status.run(async () => true, { message: '/model' });
      expect(reports.at(-1)).toMatchObject({ state: 'working', message: 'outer' });
      return true;
    }, { message: 'outer' });
    expect(reports.at(-1)?.state).toBe('done');
  });

  it('reports a cancelled activity period as idle even when an overlapping run succeeds last', async () => {
    const { status, reports } = harness();
    let releaseSecond!: () => void;
    const second = status.run(() => new Promise<boolean>(resolve => { releaseSecond = () => resolve(true); }));
    await status.run(async () => { status.cancel(); return false; });
    releaseSecond();
    await second;
    expect(reports.at(-1)?.state).toBe('idle');
  });

  it('starts a fresh outcome for the next activity period', async () => {
    const { status, reports } = harness();
    await status.run(async () => { status.cancel(); return false; });
    await status.run(async () => true);
    expect(reports.at(-1)?.state).toBe('done');
  });

  it('ignores start, runs, waits, cancellation, failure and titles after dispose', async () => {
    const { status, write, reports } = harness();
    status.start();
    status.dispose();
    const writes = write.mock.calls.length;
    const reported = reports.length;
    status.start();
    expect(await status.run(async () => status.wait('question', 'Late', async () => 'result'))).toBe('result');
    status.cancel();
    status.fail('late');
    status.setTitle('Late title');
    expect(write.mock.calls.length).toBe(writes);
    expect(reports.length).toBe(reported);
  });
});
