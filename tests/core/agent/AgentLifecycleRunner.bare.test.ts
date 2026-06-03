/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { initializeAgentManagers } from '../../../src/core/agent/AgentLifecycleRunner.js';

describe('AgentLifecycleRunner bare mode', () => {
  it('initializes only session, local skills, and workspace files in bare mode', async () => {
    const host = {
      runtime: {
        options: { bare: true },
      },
      getParallelismLimit: () => 4,
      sessionManager: { initialize: vi.fn(async () => {}) },
      projectManager: { initialize: vi.fn(async () => {}) },
      memoryManager: { initialize: vi.fn(async () => {}) },
      skillsRegistry: { initialize: vi.fn(async () => {}) },
      hookManager: { initialize: vi.fn(async () => {}) },
      workspaceFileCollector: { collectWorkspaceFiles: vi.fn(async () => []) },
    };

    await initializeAgentManagers(host as any);

    expect(host.sessionManager.initialize).toHaveBeenCalledTimes(1);
    expect(host.skillsRegistry.initialize).toHaveBeenCalledTimes(1);
    expect(host.workspaceFileCollector.collectWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(host.projectManager.initialize).not.toHaveBeenCalled();
    expect(host.memoryManager.initialize).not.toHaveBeenCalled();
    expect(host.hookManager.initialize).not.toHaveBeenCalled();
  });
});
