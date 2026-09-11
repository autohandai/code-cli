/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startAgentStatusUpdates,
  stopAgentStatusUpdates,
  TIP_ROTATION_MS,
} from '../../../src/core/agent/AgentUIRuntime.js';

function makeHost(withRenderer = true) {
  const tips = ['first', 'second', 'third'];
  let index = 0;
  const inkRenderer = { setTip: vi.fn() };
  const host = {
    statusInterval: undefined as ReturnType<typeof setInterval> | undefined,
    lastRenderedStatus: '',
    activityIndicator: {
      next: vi.fn(),
      getTip: () => tips[index],
      nextTip: () => tips[++index % tips.length],
    },
    forceRenderSpinner: vi.fn(),
    isUsingTerminalRegionsForActiveTurn: () => false,
    inkRenderer: withRenderer ? inkRenderer : undefined,
    resizeHandler: undefined,
  };
  return { host, inkRenderer };
}

describe('working tip rotation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the first tip immediately and rotates every TIP_ROTATION_MS', () => {
    const { host, inkRenderer } = makeHost();
    startAgentStatusUpdates(host as never);
    expect(inkRenderer.setTip).toHaveBeenCalledWith({ kind: 'tip', text: 'first' });

    vi.advanceTimersByTime(TIP_ROTATION_MS - 1000);
    expect(inkRenderer.setTip).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(inkRenderer.setTip).toHaveBeenLastCalledWith({ kind: 'tip', text: 'second' });

    vi.advanceTimersByTime(TIP_ROTATION_MS);
    expect(inkRenderer.setTip).toHaveBeenLastCalledWith({ kind: 'tip', text: 'third' });
    stopAgentStatusUpdates(host as never);
  });

  it('keeps refreshing the spinner every second without an Ink renderer', () => {
    const { host } = makeHost(false);
    startAgentStatusUpdates(host as never);
    vi.advanceTimersByTime(TIP_ROTATION_MS);
    expect(host.forceRenderSpinner).toHaveBeenCalledTimes(TIP_ROTATION_MS / 1000 + 1);
    stopAgentStatusUpdates(host as never);
  });
});
