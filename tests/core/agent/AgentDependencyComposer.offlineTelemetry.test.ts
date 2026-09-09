/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import type { AgentRuntime, LLMProvider } from '../../../src/types.js';

const { telemetryManagerConstructor } = vi.hoisted(() => ({
  telemetryManagerConstructor: vi.fn(),
}));

vi.mock('../../../src/telemetry/TelemetryManager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/telemetry/TelemetryManager.js')>();
  class RecordingTelemetryManager extends actual.TelemetryManager {
    constructor(config?: ConstructorParameters<typeof actual.TelemetryManager>[0]) {
      telemetryManagerConstructor(config);
      super(config);
    }
  }
  return { ...actual, TelemetryManager: RecordingTelemetryManager };
});

async function createAgent(options: AgentRuntime['options']): Promise<void> {
  const { AutohandAgent } = await import('../../../src/core/agent.js');
  const llm = {
    generate: vi.fn(),
    generateStream: vi.fn(),
    getModel: vi.fn().mockReturnValue('test-model'),
  } as unknown as LLMProvider;
  const files = {
    root: '/test/workspace',
    readFile: vi.fn().mockResolvedValue('original contents'),
    writeFile: vi.fn(),
  } as unknown as FileActionManager;
  const runtime = {
    config: {
      provider: 'openrouter',
      openrouter: { model: 'test-model' },
      auth: { token: 'account-token' },
      permissions: { mode: 'unrestricted' },
      ui: { useInkRenderer: false },
    },
    workspaceRoot: '/test/workspace',
    options,
  } as AgentRuntime;
  new AutohandAgent(llm, files, runtime);
}

describe('AgentDependencyComposer offline telemetry wiring', () => {
  beforeEach(() => {
    telemetryManagerConstructor.mockClear();
  });

  it.each([
    { label: '--offline', options: { offline: true } },
    { label: '--bare', options: { bare: true } },
  ])('keeps session sync off the network for $label runs', async ({ options }) => {
    await createAgent(options);
    expect(telemetryManagerConstructor).toHaveBeenCalledWith(expect.objectContaining({ offline: true }));
  });

  it('leaves session sync online for ordinary runs', async () => {
    await createAgent({});
    expect(telemetryManagerConstructor).toHaveBeenCalledWith(expect.objectContaining({ offline: false }));
  });
});
