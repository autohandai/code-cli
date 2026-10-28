import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { pendingQueueSnapshot, steerPendingMessage } from '../../src/testing/scenarios/queuedSteeringScenario.js';

afterEach(() => vi.useRealTimers());

function repaintingSession(permanentDrift = false) {
  const currentRows = 42;
  let queued = 0;
  let draft = '';
  let steered = false;
  let repainting = false;
  const frame = (row: number) => {
    const lines = Array<string>(currentRows).fill('');
    if (queued) {
      lines[31] = `Queue · ${queued} pending · ctrl+enter steer next`;
      lines[32] = steered ? '1. QUEUE_LATER: leave this for the following turn' : '1. STEER_NOW: mention the worktrees too';
      if (queued === 2) lines[33] = '2. QUEUE_LATER: leave this for the following turn';
    }
    lines[row] = `❯ ${draft}`;
    return '\n' + lines.join('\n');
  };
  const text = vi.fn<Session['text']>(async () => {
    vi.advanceTimersByTime(50);
    const intermediate = repainting || (permanentDrift && queued > 0);
    repainting = false;
    return frame(intermediate ? 4 : 37);
  });
  return {
    currentRows,
    text,
    waitIdle: vi.fn(async () => {}),
    waitForText: vi.fn<Session['waitForText']>(async () => frame(repainting ? 4 : 37)),
    getTerminalData: vi.fn((): ReturnType<Session['getTerminalData']> => ({
      cols: 120, rows: currentRows, cursor: [0, 0], cursorVisible: false, cursorStyle: 'block', offset: 0, totalLines: currentRows,
      lines: frame(repainting ? 4 : 37).split('\n').slice(-currentRows).map(value => ({
        spans: [{ text: value, fg: null, bg: null, flags: 0, width: value.length }],
      })),
    })),
    type: vi.fn<Session['type']>(async value => { draft = value; }),
    press: vi.fn<Session['press']>(async () => { queued++; draft = ''; repainting = true; }),
    writeRaw: vi.fn<Session['writeRaw']>(() => { queued = 1; steered = true; repainting = true; }),
  };
}

describe('queued steering terminal assertions', () => {
  it('checks queued content and the original composer position in the same complete frame', async () => {
    vi.useFakeTimers();
    const session = repaintingSession();
    const screen = await steerPendingMessage(session, { sequence: '\x1b[13;5u', selected: false, fullScreen: true });
    expect(screen.split('\n').slice(-session.currentRows)[37]).toBe('❯ KEEP_THIS_DRAFT');
    expect(pendingQueueSnapshot(screen)).toEqual([
      'Queue · 1 pending · ctrl+enter steer next', '1. QUEUE_LATER: leave this for the following turn',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still rejects a composer that remains displaced after queueing', async () => {
    vi.useFakeTimers();
    const session = repaintingSession(true);
    await expect(steerPendingMessage(session, { sequence: '\x1b[13;5u', selected: false, fullScreen: true })).rejects.toThrow();
    expect(session.press).toHaveBeenCalledOnce();
    expect(session.writeRaw).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
