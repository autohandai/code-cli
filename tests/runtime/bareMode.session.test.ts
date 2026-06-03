/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBareModeConfig } from '../../src/runtime/bareMode.js';
import type { CLIOptions, LoadedConfig } from '../../src/types.js';

const baseConfig = {
  configPath: '',
} as unknown as LoadedConfig;

describe('applyBareModeConfig external agents handling', () => {
  it('treats a directory value as an external agents path', () => {
    const options = { agents: './my-agents' } as CLIOptions;
    const result = applyBareModeConfig(baseConfig, options);
    expect(result.externalAgents).toEqual({
      enabled: true,
      paths: [path.resolve('./my-agents')],
    });
  });

  it('does not treat inline agents JSON as a filesystem path', () => {
    const options = {
      agents: '{"reviewer":{"description":"Reviews code","prompt":"Review"}}',
    } as CLIOptions;
    const result = applyBareModeConfig(baseConfig, options);
    expect(result.externalAgents).toEqual({ enabled: false, paths: [] });
  });
});
