/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Accept = (tip: string) => boolean;

const inkUIManager = vi.hoisted(() => ({
  createInkUIManager: vi.fn((options: Record<string, unknown>) => ({ options })),
}));

vi.mock('../../../src/ui/InkUIManager.js', () => ({
  createInkUIManager: inkUIManager.createInkUIManager,
}));

async function loadRuntime() {
  return await import('../../../src/core/agent/AgentUIRuntime.js');
}

function makeStatusHost(withRenderer = true) {
  const inkRenderer = { setTip: vi.fn() };
  const activityIndicator = { next: vi.fn(), getTip: vi.fn(() => 'tip'), nextTip: vi.fn(() => 'next tip') };
  const host = {
    statusInterval: undefined as ReturnType<typeof setInterval> | undefined,
    lastRenderedStatus: '',
    activityIndicator,
    forceRenderSpinner: vi.fn(),
    isUsingTerminalRegionsForActiveTurn: () => false,
    inkRenderer: withRenderer ? inkRenderer : undefined,
    resizeHandler: undefined,
  };
  return { host, inkRenderer, activityIndicator };
}

describe('working status ticker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves tips to the idle composer while a turn runs', async () => {
    const { startAgentStatusUpdates, stopAgentStatusUpdates } = await loadRuntime();
    const { host, inkRenderer, activityIndicator } = makeStatusHost();
    startAgentStatusUpdates(host as never);
    vi.advanceTimersByTime(30_000);
    expect(inkRenderer.setTip).not.toHaveBeenCalled();
    expect(activityIndicator.nextTip).not.toHaveBeenCalled();
    stopAgentStatusUpdates(host as never);
  });

  it('refreshes the spinner every second without an Ink renderer', async () => {
    const { startAgentStatusUpdates, stopAgentStatusUpdates } = await loadRuntime();
    const { host } = makeStatusHost(false);
    startAgentStatusUpdates(host as never);
    vi.advanceTimersByTime(10_000);
    expect(host.forceRenderSpinner).toHaveBeenCalledTimes(11);
    stopAgentStatusUpdates(host as never);
  });
});

describe('Ink UI tip wiring', () => {
  const ttyDescriptors = {
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
  };

  function restoreTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor);
    } else {
      delete (stream as { isTTY?: boolean }).isTTY;
    }
  }

  beforeEach(() => {
    inkUIManager.createInkUIManager.mockClear();
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    restoreTTY(process.stdout, ttyDescriptors.stdout);
    restoreTTY(process.stdin, ttyDescriptors.stdin);
  });

  function makeUIHost(options: { bare?: boolean; nextTipFitting?: (accept: Accept) => string | undefined } = {}) {
    return {
      useInkRenderer: true,
      runtime: {
        config: { ui: {} as Record<string, unknown> },
        options: { bare: options.bare ?? false },
        workspaceRoot: '/tmp/workspace',
      },
      activityIndicator: { nextTipFitting: options.nextTipFitting ?? vi.fn() },
    };
  }

  function capturedTipProvider(): ((accept: Accept) => string | undefined) | undefined {
    expect(inkUIManager.createInkUIManager).toHaveBeenCalledTimes(1);
    const options = inkUIManager.createInkUIManager.mock.calls[0]?.[0] as { tipProvider?: (accept: Accept) => string | undefined };
    return options.tipProvider;
  }

  it('draws idle tips from the activity indicator through the caller filter', async () => {
    const { initializeAgentUIManager } = await loadRuntime();
    const nextTipFitting = vi.fn((accept: Accept) => ['a tip far too long to fit', 'short'].find(accept));
    initializeAgentUIManager(makeUIHost({ nextTipFitting }) as never);

    const tipProvider = capturedTipProvider();
    expect(tipProvider?.((tip) => tip.length <= 5)).toBe('short');
    expect(nextTipFitting).toHaveBeenCalledTimes(1);
  });

  it('draws no tips while ui.showTips is off and resumes once it is turned back on', async () => {
    const { initializeAgentUIManager } = await loadRuntime();
    const nextTipFitting = vi.fn(() => 'Type / to browse every slash command');
    const host = makeUIHost({ nextTipFitting });
    host.runtime.config.ui = { showTips: false };
    initializeAgentUIManager(host as never);

    const tipProvider = capturedTipProvider();
    expect(tipProvider?.(() => true)).toBeUndefined();
    expect(nextTipFitting).not.toHaveBeenCalled();

    host.runtime.config.ui = { showTips: true };
    expect(tipProvider?.(() => true)).toBe('Type / to browse every slash command');
  });

  it('shows no tips in bare mode', async () => {
    const { initializeAgentUIManager } = await loadRuntime();
    initializeAgentUIManager(makeUIHost({ bare: true }) as never);
    expect(capturedTipProvider()).toBeUndefined();
  });
});
