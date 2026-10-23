import { describe, expect, it, vi } from 'vitest';
import { applyNoDaemonConfig } from '../../src/runtime/noDaemon.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import type { AgentRuntime, LoadedConfig } from '../../src/types.js';
import { restoreRunConfigOverlay } from '../../src/runConfigOverlay.js';
import { AutohandAgent } from '../../src/core/agent.js';

describe('--no-daemon runtime policy', () => {
  it('keeps background reflection disabled even if a setting changes during the session', () => {
    const host = { runtime: { options: { daemon: false }, config: { agent: { autoMemory: true } } } };
    const shouldReflect = Reflect.get(AutohandAgent.prototype, 'shouldRunTurnMemoryReflection') as (this: typeof host) => boolean;
    expect(shouldReflect.call(host)).toBe(false);
  });
  it('runs an ordinary foreground shell command to completion', async () => {
    const executor = new ActionExecutor({
      runtime: { config: {}, options: { daemon: false, yes: true }, workspaceRoot: process.cwd() } as AgentRuntime,
      files: {} as never,
      resolveWorkspacePath: value => value,
      confirmDangerousAction: async () => true,
    });
    const output = await executor.execute({ type: 'run_command', command: "node -e \"process.stdout.write('FOREGROUND_TOOLS_WORK')\"", background: false });
    expect(output).toContain('FOREGROUND_TOOLS_WORK');
  });
  it('disables background integrations for this run without mutating saved settings', () => {
    const config: LoadedConfig = {
      configPath: '/config.json',
      sync: { enabled: true },
      mcp: { enabled: true, servers: [{ name: 'helper', command: 'background-helper' }] },
      hooks: { enabled: true },
      ui: { promptSuggestions: true, notifications: true },
      agent: { autoMemory: true },
      features: { automaticSpecialists: true },
    };
    const result = applyNoDaemonConfig(config, { daemon: false });
    expect(result).toMatchObject({
      sync: { enabled: false }, mcp: { enabled: false, servers: [] }, hooks: { enabled: false },
      ui: { promptSuggestions: false, notifications: false }, agent: { autoMemory: false },
      features: { automaticSpecialists: false },
    });
    expect(config.sync?.enabled).toBe(true);
    expect(config.mcp?.servers).toHaveLength(1);
    expect(applyNoDaemonConfig(config, {})).toBe(config);
    const saved = structuredClone(result) as unknown as Record<string, unknown>;
    restoreRunConfigOverlay(saved, result.runOverlay!);
    expect(saved.sync).toEqual(config.sync);
    expect(saved.mcp).toEqual(config.mcp);
    expect(result.sync?.enabled).toBe(false);
  });
  it.each(['run_command', 'shell'] as const)('refuses a background %s before launching a child', async type => {
    const executor = new ActionExecutor({
      runtime: { config: {}, options: { daemon: false }, workspaceRoot: '/workspace' } as AgentRuntime,
      files: {} as never,
      resolveWorkspacePath: vi.fn(), confirmDangerousAction: vi.fn(),
    });
    expect(await executor.execute({ type, command: 'sleep 60', background: true })).toContain('--no-daemon');
  });
});
