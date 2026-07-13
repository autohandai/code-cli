/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { shutdownRpcRuntime } from '../../../src/modes/rpc/index.js';

describe('RPC runtime shutdown', () => {
  it('returns an exit status instead of terminating before cleanup can settle', () => {
    const source = readFileSync(new URL('../../../src/modes/rpc/index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('process.exit(');
    expect(source).toContain('await shutdownRpcRuntime(adapter, agent, shutdownReason)');
  });

  it('cancels adapter work before awaiting agent resource cleanup', async () => {
    const callOrder: string[] = [];
    let resolveAgentShutdown!: () => void;
    const adapter = {
      shutdown: vi.fn(() => {
        callOrder.push('adapter');
      }),
    };
    const agent = {
      shutdown: vi.fn(() => {
        callOrder.push('agent');
        return new Promise<void>((resolve) => {
          resolveAgentShutdown = resolve;
        });
      }),
    };

    let settled = false;
    const shutdownPromise = shutdownRpcRuntime(adapter, agent, 'disconnected').then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(agent.shutdown).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['adapter', 'agent']);
    expect(settled).toBe(false);
    expect(agent.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'disconnected',
      telemetryReason: 'completed',
      showSessionSummary: false,
    });

    resolveAgentShutdown();
    await shutdownPromise;
    expect(settled).toBe(true);
  });

  it('still closes agent resources when adapter shutdown throws', async () => {
    const agent = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const adapter = {
      shutdown: vi.fn(() => {
        throw new Error('notification channel closed');
      }),
    };

    await expect(shutdownRpcRuntime(adapter, agent, 'error')).resolves.toBeUndefined();
    expect(agent.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
  });
});
