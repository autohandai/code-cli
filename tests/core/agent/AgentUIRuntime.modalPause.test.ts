import { describe, expect, it, vi } from 'vitest';
import { withAgentModalPause, type AgentUIRuntimeHost } from '../../../src/core/agent/AgentUIRuntime.js';

function modalHost(renderer: { pause: () => void; resume: () => Promise<void> }) {
  const persistentInput = { pause: vi.fn(), resume: vi.fn() };
  const host = {
    stopStatusUpdates: vi.fn(),
    startStatusUpdates: vi.fn(),
    resumeSpinnerAfterModalPause: vi.fn(),
    runtime: { spinner: undefined },
    persistentInput,
    inkRenderer: renderer,
  } as unknown as AgentUIRuntimeHost;
  return { host, persistentInput };
}

describe('withAgentModalPause', () => {
  it('balances the composer pause when the renderer fails to pause', async () => {
    const { host, persistentInput } = modalHost({
      pause: () => { throw new Error('pause failed'); },
      resume: vi.fn(async () => {}),
    });
    const fn = vi.fn(async () => 'answer');

    await expect(withAgentModalPause(host, fn)).rejects.toThrow('pause failed');

    expect(fn).not.toHaveBeenCalled();
    expect(persistentInput.resume).toHaveBeenCalledTimes(persistentInput.pause.mock.calls.length);
    expect(host.startStatusUpdates).toHaveBeenCalledOnce();
  });

  it('still releases the composer when the renderer fails to resume', async () => {
    const { host, persistentInput } = modalHost({
      pause: vi.fn(),
      resume: vi.fn(async () => { throw new Error('resume failed'); }),
    });

    await expect(withAgentModalPause(host, async () => 'answer')).rejects.toThrow('resume failed');

    expect(persistentInput.pause).toHaveBeenCalledOnce();
    expect(persistentInput.resume).toHaveBeenCalledOnce();
    expect(host.startStatusUpdates).toHaveBeenCalledOnce();
  });

  it('returns the modal result and pairs every pause with a resume', async () => {
    const renderer = { pause: vi.fn(), resume: vi.fn(async () => {}) };
    const { host, persistentInput } = modalHost(renderer);

    await expect(withAgentModalPause(host, async () => 'answer')).resolves.toBe('answer');

    expect(persistentInput.pause).toHaveBeenCalledOnce();
    expect(persistentInput.resume).toHaveBeenCalledOnce();
    expect(renderer.pause).toHaveBeenCalledOnce();
    expect(renderer.resume).toHaveBeenCalledOnce();
  });
});
