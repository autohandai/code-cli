/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { stopAgentUI, type AgentUIRuntimeHost } from '../../../src/core/agent/AgentUIRuntime.js';

function createHost(): AgentUIRuntimeHost {
  return {
    terminalTitle: { setState: vi.fn() },
    inkRenderer: { setElapsed: vi.fn(), setTokens: vi.fn(), setWorking: vi.fn(), setFinalResponse: vi.fn() },
    taskStartedAt: Date.now(),
    sessionStartedAt: Date.now(),
    runtime: {},
  };
}

describe('stopAgentUI', () => {
  it('marks a failed turn as failed in the title and the transcript', () => {
    const host = createHost();
    stopAgentUI(host, true, 'Session failed');
    expect(host.terminalTitle.setState).toHaveBeenCalledWith('failed');
    expect(host.inkRenderer.setWorking).toHaveBeenCalledWith(false, 'Session failed', { succeeded: false });
  });

  it('returns to idle after an interruption instead of reporting a failure', () => {
    const host = createHost();
    stopAgentUI(host, false, undefined, { interrupted: true });
    expect(host.terminalTitle.setState).toHaveBeenCalledWith('idle');
    expect(host.terminalTitle.setState).not.toHaveBeenCalledWith('failed');
    expect(host.inkRenderer.setWorking).toHaveBeenCalledWith(false, '', { succeeded: false, interrupted: true });
  });

  it('returns to idle when the turn only awaits its review, without reporting a failure', () => {
    const host = createHost();
    stopAgentUI(host, true, undefined, { needsReview: true });
    expect(host.terminalTitle.setState).toHaveBeenCalledWith('idle');
    expect(host.terminalTitle.setState).not.toHaveBeenCalledWith('failed');
    expect(host.inkRenderer.setWorking).toHaveBeenCalledWith(false, '', { succeeded: false, needsReview: true });
  });

  it('keeps a completed turn completed', () => {
    const host = createHost();
    stopAgentUI(host);
    expect(host.terminalTitle.setState).toHaveBeenCalledWith('idle');
    expect(host.inkRenderer.setWorking).toHaveBeenCalledWith(false, '', { succeeded: true });
  });

  it('stops a plain spinner quietly when the turn was interrupted', () => {
    const spinner = { stop: vi.fn(), fail: vi.fn() };
    const host: AgentUIRuntimeHost = { terminalTitle: { setState: vi.fn() }, inkRenderer: null, runtime: { spinner } };
    stopAgentUI(host, false, undefined, { interrupted: true });
    expect(spinner.stop).toHaveBeenCalledOnce();
    expect(spinner.fail).not.toHaveBeenCalled();
  });

  it('stops a plain spinner quietly when the turn only awaits its review', () => {
    const spinner = { stop: vi.fn(), fail: vi.fn() };
    const host: AgentUIRuntimeHost = { terminalTitle: { setState: vi.fn() }, inkRenderer: null, runtime: { spinner } };
    stopAgentUI(host, true, undefined, { needsReview: true });
    expect(spinner.stop).toHaveBeenCalledOnce();
    expect(spinner.fail).not.toHaveBeenCalled();
  });
});
