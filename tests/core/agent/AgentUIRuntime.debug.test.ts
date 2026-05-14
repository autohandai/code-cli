/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('does not repeat cleanup after exit has already been requested', () => {
    const host = {
      shouldExit: true,
      clearAllQueuesAndAbort: vi.fn(),
    };

    handleAgentCtrlCExitRequest(host);

    expect(host.clearAllQueuesAndAbort).not.toHaveBeenCalled();
  });
});
