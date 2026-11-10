/** @license Apache-2.0 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResizeStreamGate } from '../../src/testing/scenarios/resizeStreamGate.js';

describe('resize stream observation gate', () => {
  it('reopens on a late viewport change and refreshes the same observation acknowledgement', async () => {
    const record = vi.fn();
    const persist = vi.fn(async (_content: string) => {});
    const gate = new ResizeStreamGate('unused', record, async () => ({ id: 3, action: 'observe', counter: 166, columns: 93, rows: 27 }), persist);
    await gate.refresh();
    gate.emitted({ counter: 180, columns: 97, rows: 28 });
    expect(gate.permits({ columns: 97, rows: 28 })).toBe(false);
    expect(gate.permits({ columns: 128, rows: 39 })).toBe(true);
    gate.emitted({ counter: 181, columns: 128, rows: 39 });
    expect(gate.permits({ columns: 128, rows: 39 })).toBe(false);
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'stream-gate', command: 3, counter: 181,
      columns: 128, rows: 39, paused: true }));
    await gate.dispose();
    const snapshot: unknown = JSON.parse(persist.mock.calls.at(-1)?.[0].split('\n')[0] ?? '{}');
    expect(snapshot).toMatchObject({ kind: 'stream-state', command: 3, counter: 181, columns: 128, rows: 39,
      paused: true, revision: expect.any(Number) });
  });

  it('requires a post-command chunk rather than pausing on intermediate drag output', async () => {
    const gate = new ResizeStreamGate('unused', vi.fn(), async () => ({ id: 1, action: 'observe', counter: 10, columns: 100, rows: 30 }), async () => {});
    gate.emitted({ counter: 11, columns: 90, rows: 28 });
    await gate.refresh();
    expect(gate.permits({ columns: 90, rows: 28 })).toBe(true);
    gate.emitted({ counter: 12, columns: 90, rows: 28 });
    expect(gate.permits({ columns: 90, rows: 28 })).toBe(false);
    await gate.dispose();
  });

  it('bounds control reads before parsing and disposes after a read failure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'resize-stream-gate-'));
    const file = path.join(directory, 'command.json');
    const gate = new ResizeStreamGate(file, vi.fn());
    try {
      await writeFile(file, 'x'.repeat(513));
      await gate.refresh();
      expect(() => gate.permits({ columns: 100, rows: 30 })).toThrow('exceeded 512 bytes');
    } finally { await gate.dispose(); await rm(directory, { recursive: true, force: true }); }
  });

  it('pauses only after a newer chunk was emitted at the resulting viewport and resumes', async () => {
    const record = vi.fn();
    let command = { id: 1, action: 'observe', counter: 10, columns: 100, rows: 30 };
    const gate = new ResizeStreamGate('unused', record, async () => command, async () => {});
    await gate.refresh();
    gate.emitted({ counter: 11, columns: 100, rows: 30 });
    expect(gate.permits({ columns: 100, rows: 30 })).toBe(true);
    expect(gate.permits({ columns: 90, rows: 28 })).toBe(true);
    gate.emitted({ counter: 12, columns: 90, rows: 28 });
    expect(gate.permits({ columns: 90, rows: 28 })).toBe(false);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stream-gate', command: 1, counter: 12,
      columns: 90, rows: 28, paused: true }));
    await gate.refresh();
    command = { id: 2, action: 'resume', counter: 12, columns: 90, rows: 28 };
    await gate.refresh();
    expect(gate.permits({ columns: 90, rows: 28 })).toBe(true);
    gate.emitted({ counter: 13, columns: 90, rows: 28 });
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'stream-chunk', command: 2, counter: 13 }));
    await gate.dispose();
  });

  it('owns one pending read and suppresses late work after disposal', async () => {
    let release: ((command: unknown) => void) | undefined;
    const read = vi.fn(() => new Promise<unknown>(resolve => { release = resolve; }));
    const record = vi.fn();
    const gate = new ResizeStreamGate('unused', record, read, async () => {});
    const pending = gate.refresh();
    void gate.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    const disposed = gate.dispose();
    release?.({ id: 1, action: 'resume', counter: 0, columns: 100, rows: 30 });
    await pending;
    await disposed;
    expect(record).not.toHaveBeenCalled();
    expect(gate.permits({ columns: 100, rows: 30 })).toBe(false);
    await gate.refresh();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { id: 40, action: 'resume', counter: 0, columns: 100, rows: 30 }])('fails closed on invalid bounded control %j', async command => {
    const gate = new ResizeStreamGate('unused', vi.fn(), async () => command, async () => {});
    await gate.refresh();
    expect(() => gate.permits({ columns: 100, rows: 30 })).toThrow('Invalid resize stream command');
    await gate.dispose();
  });
});
