import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRuntimeContextWindow } from '../../src/providers/runtimeContextWindow.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runtime context deadline', () => {
  it('settles when the deadline aborts even if the provider ignores its signal', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const remove = vi.spyOn(deadline.signal, 'removeEventListener');
    const pending = resolveRuntimeContextWindow(() => new Promise(() => {}));
    deadline.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(AbortSignal.timeout).toHaveBeenCalledWith(2000);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('releases the abort listener after successful metadata', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const remove = vi.spyOn(deadline.signal, 'removeEventListener');
    await expect(resolveRuntimeContextWindow(async () => 4096)).resolves.toBe(4096);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('cancels without waiting for a noncooperative provider', async () => {
    const controller = new AbortController();
    const pending = resolveRuntimeContextWindow(() => new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 4096.5])('rejects invalid limit %s', async (value) => {
    await expect(resolveRuntimeContextWindow(async () => value)).resolves.toBeUndefined();
  });
});
