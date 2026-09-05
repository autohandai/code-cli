/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { executeReviewCliInvocation } from '../src/review/reviewCliRuntime.js';
import type { LoadedConfig } from '../src/types.js';

const config = { provider: 'openrouter' } as LoadedConfig;
const authenticatedConfig = {
  ...config,
  auth: { token: 'test-token' },
} as LoadedConfig;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    cwd: () => '/workspace',
    refreshModelCatalog: vi.fn().mockResolvedValue(undefined),
    loadConfig: vi.fn().mockResolvedValue(config),
    resolveWorkspaceRoot: vi.fn().mockReturnValue('/workspace/repo'),
    validateWorkspacePath: vi.fn().mockResolvedValue({ valid: true }),
    checkWorkspaceSafety: vi.fn().mockReturnValue({ safe: true }),
    authenticate: vi.fn().mockResolvedValue(authenticatedConfig),
    buildInstruction: vi.fn().mockResolvedValue('review instruction'),
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('review CLI runtime', () => {
  it('prepares and runs one restricted, non-interactive review turn', async () => {
    const deps = dependencies();
    const request = {
      kind: 'architecture' as const,
      audience: 'technical' as const,
      format: 'markdown' as const,
      target: 'packages/api',
    };

    await executeReviewCliInvocation({
      interactive: false,
      request,
      runtimeOptions: {
        path: '/workspace/repo',
        config: '/workspace/config.json',
        model: 'provider/reviewer',
        offline: true,
        bare: true,
        json: 'local',
      },
    }, deps);

    expect(deps.refreshModelCatalog).toHaveBeenCalledWith({ bare: true, offline: true });
    expect(deps.loadConfig).toHaveBeenCalledWith('/workspace/config.json', '/workspace');
    expect(deps.authenticate).toHaveBeenCalledWith(config, { bare: true });
    expect(deps.buildInstruction).toHaveBeenCalledWith('/workspace/repo', request);
    expect(deps.run).toHaveBeenCalledWith({
      authenticatedConfig,
      options: expect.objectContaining({
        bare: true,
        commandOutputFormat: 'json',
        dryRun: false,
        model: 'provider/reviewer',
        path: '/workspace/repo',
        prompt: 'review instruction',
        restricted: true,
        unrestricted: false,
        yes: false,
      }),
      review: { request, surface: 'cli' },
    });
  });

  it('rejects an inaccessible workspace before authentication', async () => {
    const deps = dependencies({
      validateWorkspacePath: vi.fn().mockResolvedValue({
        valid: false,
        error: 'Workspace path does not exist',
      }),
    });

    await expect(executeReviewCliInvocation({
      interactive: false,
      request: { kind: 'changes', audience: 'mixed', format: 'markdown' },
      runtimeOptions: {},
    }, deps)).rejects.toThrow('Workspace path does not exist');

    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('rejects a dangerously broad workspace before authentication', async () => {
    const deps = dependencies({
      checkWorkspaceSafety: vi.fn().mockReturnValue({
        safe: false,
        reason: 'This directory is too broad.',
      }),
    });

    await expect(executeReviewCliInvocation({
      interactive: false,
      request: { kind: 'changes', audience: 'mixed', format: 'markdown' },
      runtimeOptions: {},
    }, deps)).rejects.toThrow('This directory is too broad');

    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('rejects an invalid structured output request before starting the model', async () => {
    const deps = dependencies();

    await expect(executeReviewCliInvocation({
      interactive: false,
      request: { kind: 'changes', audience: 'mixed', format: 'markdown' },
      runtimeOptions: { json: 'verbose' },
    }, deps)).rejects.toThrow('Invalid --json value');

    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
});
