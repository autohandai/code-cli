/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentCtrlCExitRequest, initializeAgentUI } from '../../../src/core/agent/AgentUIRuntime.js';

const originalDebug = process.env.AUTOHAND_DEBUG;

afterEach(() => {
  if (originalDebug === undefined) {
    delete process.env.AUTOHAND_DEBUG;
  } else {
    process.env.AUTOHAND_DEBUG = originalDebug;
  }
  vi.restoreAllMocks();
});

describe('AgentUIRuntime debug output', () => {
  it('routes AUTOHAND_DEBUG startup diagnostics through the agent debug writer', async () => {
    process.env.AUTOHAND_DEBUG = '1';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const writeDebugLine = vi.fn();

    await initializeAgentUI(
      {
        useInkRenderer: false,
        writeDebugLine,
        initFallbackSpinner: vi.fn(),
      },
      undefined,
      undefined,
      true
    );

    expect(writeDebugLine).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] initializeUI: useInkRenderer=false'));
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

describe('AgentUIRuntime Ctrl+C exit request', () => {
  it('marks the interactive loop for exit and delegates queue/abort cleanup', () => {
    const clearAllQueuesAndAbort = vi.fn();
    const host = {
      shouldExit: false,
      clearAllQueuesAndAbort,
    };

    handleAgentCtrlCExitRequest(host);

    expect(host.shouldExit).toBe(true);
    expect(clearAllQueuesAndAbort).toHaveBeenCalledOnce();
  });

  it('aborts the runtime shutdown controller so startup waits stop parking the exit', () => {
    const controller = new AbortController();
    const host = {
      shouldExit: false,
      clearAllQueuesAndAbort: vi.fn(),
      runtimeResourceShutdownController: controller,
    };

    handleAgentCtrlCExitRequest(host);

    expect(controller.signal.aborted).toBe(true);
    expect(host.shouldExit).toBe(true);
  });

  it('does not repeat cleanup after exit has already been requested', () => {
    const host = {
      shouldExit: true,
      clearAllQueuesAndAbort: vi.fn(),
    };

    handleAgentCtrlCExitRequest(host);

    expect(host.clearAllQueuesAndAbort).not.toHaveBeenCalled();
  });
});

describe('AgentUIRuntime startup working state', () => {
  const ttyDescriptors = {
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
  };

  function createInkHost() {
    const inkRenderer = { setAnnouncement: vi.fn(), isRunning: () => true };
    const ui = {
      start: vi.fn().mockResolvedValue(undefined),
      setWorking: vi.fn(),
      getInkRenderer: () => inkRenderer,
    };
    return {
      useInkRenderer: true,
      ui,
      runtime: {},
      syncProviderModelStatusLine: vi.fn(),
      writeDebugLine: vi.fn(),
      initFallbackSpinner: vi.fn(),
    };
  }

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    for (const [stream, descriptor] of [[process.stdout, ttyDescriptors.stdout], [process.stdin, ttyDescriptors.stdin]] as const) {
      if (descriptor) {
        Object.defineProperty(stream, 'isTTY', descriptor);
      } else {
        delete (stream as { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('leaves the composer idle when Ink starts before any instruction exists', async () => {
    const host = createInkHost();

    await initializeAgentUI(host, undefined, undefined, true);

    expect(host.ui.start).toHaveBeenCalledOnce();
    expect(host.ui.setWorking).not.toHaveBeenCalled();
  });

  it('shows the gathering status when a cancellable turn starts', async () => {
    const host = createInkHost();

    await initializeAgentUI(host, new AbortController(), () => undefined, true);

    expect(host.ui.setWorking).toHaveBeenCalledWith(true, 'Gathering context...');
  });
});
