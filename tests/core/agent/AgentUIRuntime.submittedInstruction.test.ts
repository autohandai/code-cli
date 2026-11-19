/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
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
    expect(host.inkRenderer.addAssistantMessage).toHaveBeenCalledWith('No background processes running.', false);
  });

  it('dispatches /stop with its argument immediately instead of queueing it', async () => {
    const handleSlashCommand = vi.fn().mockResolvedValue('Stopped "bun run dev" (pid 1234).');
    const host = createHost(handleSlashCommand);

    await handleAgentInkSubmittedInstruction(host as any, '/stop 1');

    expect(handleSlashCommand).toHaveBeenCalledWith('/stop', ['1']);
    expect(host.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.inkRenderer.addAssistantMessage).toHaveBeenCalledWith('Stopped "bun run dev" (pid 1234).', false);
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

describe('steerAgentActiveInstruction', () => {
  it('steers into the running turn without queueing or adding a separate receipt', async () => {
    const { steerAgentActiveInstruction } = await import('../../../src/core/agent/AgentUIRuntime.js');
    const { SteeringQueue } = await import('../../../src/core/agent/SteeringQueue.js');
    const host = createHost();
    host.steering = new SteeringQueue();
    host.inkRenderer.addUserMessage = vi.fn();
    host.inkRenderer.addNotification = vi.fn();

    expect(await steerAgentActiveInstruction(host, '  focus on tests ')).toBe(true);

    expect(host.steering.drain()).toEqual(['focus on tests']);
    expect(host.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.inkRenderer.addUserMessage).toHaveBeenCalledWith('focus on tests');
    expect(host.inkRenderer.addNotification).not.toHaveBeenCalled();
  });

  it.each(['/ps', '!ls', ':reviewer ship it'])('runs %s through the submit path even while a turn is active', async (text) => {
    const { steerAgentActiveInstruction } = await import('../../../src/core/agent/AgentUIRuntime.js');
    const { SteeringQueue } = await import('../../../src/core/agent/SteeringQueue.js');
    const host = createHost();
    host.steering = new SteeringQueue();
    host.handleInkSubmittedInstruction = vi.fn().mockResolvedValue(undefined);

    expect(await steerAgentActiveInstruction(host, text)).toBe(false);
    expect(host.handleInkSubmittedInstruction).toHaveBeenCalledWith(text);
    expect(host.steering.size).toBe(0);
  });

  it('submits normally when no turn is running', async () => {
    const { steerAgentActiveInstruction } = await import('../../../src/core/agent/AgentUIRuntime.js');
    const { SteeringQueue } = await import('../../../src/core/agent/SteeringQueue.js');
    const host = createHost();
    host.isInstructionActive = false;
    host.steering = new SteeringQueue();
    host.handleInkSubmittedInstruction = vi.fn().mockResolvedValue(undefined);

    expect(await steerAgentActiveInstruction(host, 'hello')).toBe(false);
    expect(host.handleInkSubmittedInstruction).toHaveBeenCalledWith('hello');
    expect(host.steering.size).toBe(0);
  });
});

describe('handleAgentInkSubmittedInstruction while idle', () => {
  /** A renderer that, like InkRenderer, drops an identical instruction arriving in the same input burst. */
  function createIdleHost() {
    const queue: string[] = [];
    let last: string | undefined;
    const host = {
      ...createHost(vi.fn()),
      isInstructionActive: false,
      queue,
      inkInstructionResolver: null as (() => void) | null,
    };
    const inkRenderer = {
      ...host.inkRenderer,
      isDuplicateQueuedInstruction: vi.fn((text: string) => text === last),
      addQueuedInstruction: vi.fn((text: string) => {
        if (text === last) return;
        last = text;
        queue.push(text);
      }),
    };
    return { ...host, inkRenderer };
  }

  it.each(['/discovery', 'run the tests again'])('never echoes a submission of %s that the renderer dropped as a duplicate', async (text) => {
    const host = createIdleHost();

    await handleAgentInkSubmittedInstruction(host as any, text);
    await handleAgentInkSubmittedInstruction(host as any, text);

    expect(host.queue).toEqual([text]);
    expect(host.inkRenderer.addUserMessage).toHaveBeenCalledTimes(1);
    expect(host.inkRenderer.addUserMessage).toHaveBeenCalledWith(text);
  });

  it('echoes and queues two different submissions made back to back', async () => {
    const host = createIdleHost();

    await handleAgentInkSubmittedInstruction(host as any, '/discovery');
    await handleAgentInkSubmittedInstruction(host as any, '/help');

    expect(host.queue).toEqual(['/discovery', '/help']);
    expect(host.inkRenderer.addUserMessage.mock.calls.map(([message]) => message)).toEqual(['/discovery', '/help']);
  });

  it('wakes the idle loop for an accepted submission and echoes with renderers that cannot report duplicates', async () => {
    const host = { ...createHost(vi.fn()), isInstructionActive: false, inkInstructionResolver: null as (() => void) | null };
    const resolver = vi.fn();
    host.inkInstructionResolver = resolver;

    await handleAgentInkSubmittedInstruction(host as any, '/discovery');

    expect(host.inkRenderer.addUserMessage).toHaveBeenCalledWith('/discovery');
    expect(host.inkRenderer.addQueuedInstruction).toHaveBeenCalledWith('/discovery');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(host.inkInstructionResolver).toBeNull();
  });
});

describe('duplicate submissions against the real renderer queue', () => {
  let now = 1_000;
  let renderer: InkRenderer | undefined;
  afterEach(() => {
    renderer?.stop();
    renderer = undefined;
    vi.restoreAllMocks();
  });

  function createSession() {
    now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const created = new InkRenderer({ onInstruction: vi.fn(), onEscape: vi.fn(), onCtrlC: vi.fn() });
    renderer = created;
    vi.spyOn(created, 'isRunning').mockReturnValue(true);
    const echo = vi.spyOn(created, 'addUserMessage');
    const host = {
      isInstructionActive: false,
      inkRenderer: created,
      inkInstructionResolver: null as (() => void) | null,
      inkSubmittedInstructionEchoes: [] as string[],
    };
    const submit = (text: string) => handleAgentInkSubmittedInstruction(host as any, text);
    const drain = (): string[] => {
      const drained: string[] = [];
      for (let next = created.dequeueInstruction(); next !== undefined; next = created.dequeueInstruction()) drained.push(next);
      return drained;
    };
    return { host, echo, submit, drain };
  }

  it('echoes and queues an identical submission inside the window exactly once, leaving no pending echo behind', async () => {
    const { host, echo, submit, drain } = createSession();

    await submit('/discovery');
    now += 400;
    await submit('/discovery');

    expect(echo.mock.calls).toEqual([['/discovery']]);
    expect(host.inkSubmittedInstructionEchoes).toEqual(['/discovery']);
    expect(drain()).toEqual(['/discovery']);
  });

  it('echoes and queues both identical submissions once the window has passed', async () => {
    const { host, echo, submit, drain } = createSession();

    await submit('/discovery');
    now += 1_000;
    await submit('/discovery');

    expect(echo.mock.calls).toEqual([['/discovery'], ['/discovery']]);
    expect(host.inkSubmittedInstructionEchoes).toEqual(['/discovery', '/discovery']);
    expect(drain()).toEqual(['/discovery', '/discovery']);
  });

  it('runs the same command again after the first has been processed and the window has passed', async () => {
    const { echo, submit, drain } = createSession();

    await submit('/discovery');
    expect(drain()).toEqual(['/discovery']);
    now += 6_000;
    await submit('/discovery');

    expect(echo).toHaveBeenCalledTimes(2);
    expect(drain()).toEqual(['/discovery']);
  });

  it('does not suppress different text inside the window', async () => {
    const { echo, submit, drain } = createSession();

    await submit('/discovery');
    now += 10;
    await submit('/help');
    now += 10;
    await submit('fix the failing test');

    expect(echo.mock.calls).toEqual([['/discovery'], ['/help'], ['fix the failing test']]);
    expect(drain()).toEqual(['/discovery', '/help', 'fix the failing test']);
  });

  it('wakes the idle loop only for the submission that was queued', async () => {
    const { host, submit } = createSession();
    const first = vi.fn();
    host.inkInstructionResolver = first;
    await submit('/discovery');
    const second = vi.fn();
    host.inkInstructionResolver = second;
    now += 100;
    await submit('/discovery');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(host.inkInstructionResolver).toBe(second);
  });
});
