/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';

describe('AutohandAgent debug output with Ink renderer', () => {
  it('routes debug lines through Ink notifications instead of raw stderr while Ink is running', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const addNotification = vi.fn();

    agent.readlinePromptActive = false;
    agent.persistentInputActiveTurn = false;
    agent.deferredDebugLines = [];
    agent.inkRenderer = {
      isRunning: () => true,
      addNotification,
    };

    try {
      (agent as any).writeDebugLine('[memory] turn reflection saved 5 memories this workspace');

      expect(addNotification).toHaveBeenCalledWith('[memory] turn reflection saved 5 memories this workspace');
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
