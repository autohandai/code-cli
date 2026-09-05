/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { handleAgentInkSubmittedInstruction } from '../../../src/core/agent/AgentUIRuntime.js';

describe('interactive session agent inspector', () => {
  it('opens immediately during a running instruction without queueing another model turn', async () => {
    const setAgentRunsPanelVisible = vi.fn();
    const addQueuedInstruction = vi.fn();
    const handleSlashCommand = vi.fn(async () => { setAgentRunsPanelVisible(true); return null; });
    await handleAgentInkSubmittedInstruction({
      isInstructionActive: true,
      parseSlashCommand: () => ({ command: '/agents', args: ['view'] }),
      handleSlashCommand,
      inkRenderer: { setAgentRunsPanelVisible, addQueuedInstruction },
    }, '/agents view');
    expect(setAgentRunsPanelVisible).toHaveBeenCalledWith(true);
    expect(addQueuedInstruction).not.toHaveBeenCalled();
    expect(handleSlashCommand).toHaveBeenCalledWith('/agents', ['view']);
  });
});
