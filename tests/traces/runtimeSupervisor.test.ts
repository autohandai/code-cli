import { describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import {
  reconcileAhTraces,
  shouldReconcileAhTracesAtStartup,
} from '../../src/traces/supervisor/runtime.js';
import { minimalAhTracesDaemonEnvironment } from '../../src/traces/supervisor/NodeAhTracesSupervisorHost.js';

function config(enabled: boolean): LoadedConfig {
  return {
    configPath: '/tmp/config.json',
    traces: { enabled },
  } as LoadedConfig;
}

describe('reconcileAhTraces', () => {
  it('does not start persistent trace integrations in bare mode', () => {
    expect(shouldReconcileAhTracesAtStartup(true, {})).toBe(false);
    expect(shouldReconcileAhTracesAtStartup(false, { AUTOHAND_CODE_SIMPLE: '1' })).toBe(false);
    expect(shouldReconcileAhTracesAtStartup(false, {})).toBe(true);
  });

  it('passes configured agent homes to the sidecar without forwarding credentials', () => {
    expect(minimalAhTracesDaemonEnvironment({
      HOME: '/Users/tester',
      CLAUDE_CONFIG_DIR: '/private/claude',
      CODEX_HOME: '/private/codex',
      AUTOHAND_API_KEY: 'must-not-leak',
    }, '/tmp/config.json')).toMatchObject({
      HOME: '/Users/tester',
      CLAUDE_CONFIG_DIR: '/private/claude',
      CODEX_HOME: '/private/codex',
      AUTOHAND_CONFIG: '/tmp/config.json',
    });
    expect(minimalAhTracesDaemonEnvironment({ AUTOHAND_API_KEY: 'must-not-leak' }, undefined))
      .not.toHaveProperty('AUTOHAND_API_KEY');
  });

  it.each([true, false])('maps the persisted master switch to daemon supervision (%s)', async (enabled) => {
    const reconcile = vi.fn(async () => enabled
      ? { status: 'running' as const, pid: 1, restarted: false }
      : { status: 'disabled' as const });

    await reconcileAhTraces(config(enabled), {
      supervisor: { reconcile },
      hasRuntimeArtifacts: () => true,
    });

    expect(reconcile).toHaveBeenCalledWith({ enabled });
  });

  it('does not serialize disabled CLI processes when no trace runtime artifacts exist', async () => {
    const reconcile = vi.fn();

    await expect(reconcileAhTraces(config(false), {
      supervisor: { reconcile },
      hasRuntimeArtifacts: () => false,
    })).resolves.toEqual({ status: 'disabled' });

    expect(reconcile).not.toHaveBeenCalled();
  });

  it('contains startup failures but surfaces them for post-settings enforcement', async () => {
    const reconcile = vi.fn(async () => { throw new Error('missing binary'); });

    await expect(reconcileAhTraces(config(true), { supervisor: { reconcile } }))
      .resolves.toEqual({ status: 'error', code: 'unavailable' });
    await expect(reconcileAhTraces(config(true), { supervisor: { reconcile }, strict: true }))
      .rejects.toThrow('missing binary');
  });
});
