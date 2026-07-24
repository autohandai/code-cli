/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { shutdownAgentRuntimeResources } from '../../../src/core/agent/AgentLifecycleRunner.js';

describe('shutdownAgentRuntimeResources', () => {
  it('kills every remaining background process on shutdown', async () => {
    const killAll = vi.fn().mockResolvedValue(undefined);
    const host = {
      backgroundProcessRegistry: { killAll },
    } as any;

    await shutdownAgentRuntimeResources(host);

    expect(killAll).toHaveBeenCalledTimes(1);
  });

  it('does not throw when there is no registry on the host', async () => {
    const host = {} as any;

    await expect(shutdownAgentRuntimeResources(host)).resolves.toBeUndefined();
  });
});
