/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import { TelemetryManager } from '../../../src/telemetry/TelemetryManager.js';
import type { AgentRuntime } from '../../../src/types.js';
import { ProviderConfigManager } from '../../../src/core/agent/ProviderConfigManager.js';

vi.mock('../../../src/config.js', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
  getProviderConfig: vi.fn((config, provider) => config[provider]),
}));

function createManager(opts: {
  runtime: AgentRuntime;
  syncProviderModelStatusLine?: () => void;
}): ProviderConfigManager {
  const llm = { setModel: vi.fn(), getContextWindow: vi.fn() } as unknown as LLMProvider;
  return new ProviderConfigManager(
    opts.runtime,
    () => llm,
    () => {},
    () => opts.runtime.config.provider ?? 'openrouter',
    () => {},
    () => undefined,
    () => {},
    new TelemetryManager(),
    {} as ActionExecutor,
    () => {},
    () => {},
    () => {},
    opts.syncProviderModelStatusLine ?? (() => {}),
  );
}

describe('ProviderConfigManager.applyModelChangeRemote syncs status line', () => {
  it('calls syncProviderModelStatusLine after a successful model change', async () => {
    const syncProviderModelStatusLine = vi.fn();
    const runtime = {
      config: { provider: 'openrouter', openrouter: { model: 'old-model' } },
      options: { model: 'old-model' },
      isRpcMode: false,
    } as unknown as AgentRuntime;

    const manager = createManager({ runtime, syncProviderModelStatusLine });
    await manager.applyModelChangeRemote('openrouter', 'new-model');

    expect(syncProviderModelStatusLine).toHaveBeenCalledTimes(1);
  });

  it('does not call syncProviderModelStatusLine when model is unchanged', async () => {
    const syncProviderModelStatusLine = vi.fn();
    const runtime = {
      config: { provider: 'openrouter', openrouter: { model: 'same-model' } },
      options: { model: 'same-model' },
      isRpcMode: false,
    } as unknown as AgentRuntime;

    const manager = createManager({ runtime, syncProviderModelStatusLine });
    await manager.applyModelChangeRemote('openrouter', 'same-model');

    expect(syncProviderModelStatusLine).not.toHaveBeenCalled();
  });
});

