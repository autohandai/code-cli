import { describe, expect, it, vi } from 'vitest';
import { TeammateThreadBudget } from '../../../src/core/teams/TeammateThreadBudget.js';

describe('TeammateThreadBudget', () => {
  it('waits for the lead grant and releases exactly once', async () => {
    const send = vi.fn();
    const budget = new TeammateThreadBudget(send);
    const acquired = budget.tryAcquire('nested-run');
    const requestId = send.mock.calls[0][1].requestId;
    expect(send).toHaveBeenCalledWith('team.threadAcquire', { requestId, runId: 'nested-run' });
    budget.handleResult({ requestId, granted: true });
    const lease = await acquired;
    await lease.release();
    await lease.release();
    expect(send.mock.calls.filter(([method]) => method === 'team.threadRelease')).toHaveLength(1);
    budget.dispose();
  });

  it('propagates a refused lease without running independent child work', async () => {
    const send = vi.fn();
    const budget = new TeammateThreadBudget(send);
    const acquired = budget.tryAcquire('nested-run');
    budget.handleResult({ requestId: send.mock.calls[0][1].requestId, granted: false, error: 'Session limit reached' });
    await expect(acquired).rejects.toThrow('Session limit reached');
    budget.dispose();
  });

  it('releases timed-out grants and ignores delayed replies', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const budget = new TeammateThreadBudget(send, 100);
      const acquired = budget.tryAcquire('nested-run');
      const rejected = expect(acquired).rejects.toThrow('Timed out');
      const requestId = send.mock.calls[0][1].requestId;
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(send).toHaveBeenCalledWith('team.threadRelease', { requestId });
      budget.handleResult({ requestId, granted: true });
      budget.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending leases and releases active ones on disconnect', async () => {
    const send = vi.fn();
    const budget = new TeammateThreadBudget(send);
    const active = budget.tryAcquire('active');
    budget.handleResult({ requestId: send.mock.calls[0][1].requestId, granted: true });
    const lease = await active;
    const pending = budget.tryAcquire('pending');
    budget.dispose();
    await expect(pending).rejects.toThrow('disconnected');
    await lease.release();
    expect(send.mock.calls.filter(([method]) => method === 'team.threadRelease')).toHaveLength(2);
    await expect(budget.tryAcquire('later')).rejects.toThrow('disconnected');
  });

  it('retains active leases while disconnected work is still stopping', async () => {
    const send = vi.fn();
    const budget = new TeammateThreadBudget(send);
    const active = budget.tryAcquire('active');
    budget.handleResult({ requestId: send.mock.calls[0][1].requestId, granted: true });
    const lease = await active;
    budget.disconnect();
    expect(send.mock.calls.filter(([method]) => method === 'team.threadRelease')).toHaveLength(0);
    await lease.release();
    expect(send.mock.calls.filter(([method]) => method === 'team.threadRelease')).toHaveLength(1);
    budget.dispose();
  });
});
