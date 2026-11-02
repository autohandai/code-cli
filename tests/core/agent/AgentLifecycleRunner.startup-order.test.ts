import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentInteractive, runAgentInteractiveLoop } from '../../../src/core/agent/AgentLifecycleRunner.js';

const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
afterEach(() => {
  if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks();
});

describe('interactive first paint', () => {
  it.each([false, true])('mounts the composer before starting background initialization; fullscreen=%s', async fullScreenMode => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const mounting = Promise.withResolvers<void>();
    const events: string[] = [];
    const renderer = {};
    const host = {
      runtime: { config: { provider: 'openrouter', features: { fullScreenMode } }, options: {} },
      pendingInkInstructions: [],
      useInkRenderer: true,
      inkRenderer: undefined as typeof renderer | undefined,
      mcpStartupCoordinator: { prepareForInteractiveStartup: vi.fn() },
      performBackgroundInit: vi.fn(async () => { events.push('background'); }),
      initializeUI: vi.fn(async () => {
        await mounting.promise;
        host.inkRenderer = renderer;
        events.push('mounted');
      }),
      setComposerIdle: vi.fn(() => { events.push('idle'); }),
      installExitSignalHandlers: vi.fn(),
      removeExitSignalHandlers: vi.fn(),
      shouldExit: true,
      closeSession: vi.fn(async () => {}),
      runInteractiveLoop: async () => runAgentInteractiveLoop(host),
    };

    const startup = runAgentInteractive(host);
    try {
      await vi.waitFor(() => expect(host.initializeUI).toHaveBeenCalledOnce());
      expect(host.performBackgroundInit).not.toHaveBeenCalled();
    } finally {
      mounting.resolve();
      await startup;
    }

    expect(events).toEqual(['mounted', 'idle', 'background']);
    expect(host.initializeUI).toHaveBeenCalledOnce();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });
});
