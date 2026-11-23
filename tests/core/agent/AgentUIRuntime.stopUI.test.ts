/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { showAgentTurnStarting, stopAgentUI, type AgentUIRuntimeHost } from '../../../src/core/agent/AgentUIRuntime.js';

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

describe('showAgentTurnStarting', () => {
  const runningHost = (): AgentUIRuntimeHost => {
    const host = createHost();
    host.inkRenderer.isRunning = () => true;
    host.ui = { setWorking: vi.fn() };
    return host;
  };

  it('raises the working state and the working title before the turn has its own UI', () => {
    const host = runningHost();

    showAgentTurnStarting(host);

    expect(host.inkRenderer.setWorking).toHaveBeenCalledWith(true, 'Starting...');
    expect(host.inkRenderer.setElapsed).toHaveBeenCalledWith('0m 00s');
    expect(host.terminalTitle.setState).toHaveBeenCalledWith('working');
  });

  it('returns the composer to idle when the turn ends before its UI starts', () => {
    const host = runningHost();

    showAgentTurnStarting(host)();

    expect(host.inkRenderer.setWorking).toHaveBeenLastCalledWith(false);
    expect(host.terminalTitle.setState).toHaveBeenLastCalledWith('idle');
  });

  it('does nothing while the interactive renderer is not on screen', () => {
    const host = createHost();
    host.inkRenderer.isRunning = () => false;

    showAgentTurnStarting(host)();

    expect(host.inkRenderer.setWorking).not.toHaveBeenCalled();
    expect(host.terminalTitle.setState).not.toHaveBeenCalled();
  });
});
