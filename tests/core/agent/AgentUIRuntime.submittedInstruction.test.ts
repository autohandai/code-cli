/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { handleAgentInkSubmittedInstruction } from '../../../src/core/agent/AgentUIRuntime.js';

function createHost(handleSlashCommand: ReturnType<typeof vi.fn>) {
  return {
    isInstructionActive: true,
    parseSlashCommand: (input: string) => {
      const [command, ...args] = input.trim().split(/\s+/);
      return { command: command ?? '', args };
    },
    handleSlashCommand,
    executeImmediateShellCommand: vi.fn(),
    inkRenderer: {
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      addQueuedInstruction: vi.fn(),
      isRunning: () => true,
    },
    inkInstructionResolver: null,
  };
}

describe('handleAgentInkSubmittedInstruction while an instruction is active', () => {
  it('dispatches /ps immediately instead of queueing it', async () => {
    const handleSlashCommand = vi.fn().mockResolvedValue('No background processes running.');
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, '/ps');

    expect(handleSlashCommand).toHaveBeenCalledWith('/ps', []);
    expect(host.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.inkRenderer.addAssistantMessage).toHaveBeenCalledWith('No background processes running.');
  });

  it('dispatches /stop with its argument immediately instead of queueing it', async () => {
    const handleSlashCommand = vi.fn().mockResolvedValue('Stopped "bun run dev" (pid 1234).');
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, '/stop 1');

    expect(handleSlashCommand).toHaveBeenCalledWith('/stop', ['1']);
    expect(host.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.inkRenderer.addAssistantMessage).toHaveBeenCalledWith('Stopped "bun run dev" (pid 1234).');
  });

  it('still dispatches /deep-research status immediately (pre-existing behavior)', async () => {
    const handleSlashCommand = vi.fn().mockResolvedValue('State: Running');
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, '/deep-research status');

    expect(handleSlashCommand).toHaveBeenCalledWith('/deep-research', ['status']);
    expect(host.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
  });

  it('still queues a plain natural-language instruction', async () => {
    const handleSlashCommand = vi.fn();
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, 'run the tests again');

    expect(handleSlashCommand).not.toHaveBeenCalled();
    expect(host.inkRenderer.addQueuedInstruction).toHaveBeenCalledWith('run the tests again');
  });

  it('still queues a slash command that is not on the concurrent-safe list', async () => {
    const handleSlashCommand = vi.fn();
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, '/model');

    expect(handleSlashCommand).not.toHaveBeenCalled();
    expect(host.inkRenderer.addQueuedInstruction).toHaveBeenCalledWith('/model');
  });
});
