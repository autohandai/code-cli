/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { getProviderConfig, loadConfig } from '../src/config';
import type { AutohandConfig } from '../src/types';

describe('getProviderConfig', () => {
  it('allows llama.cpp config without an explicit model', () => {
    const config = {
      provider: 'llamacpp',
      llamacpp: {
        baseUrl: 'http://localhost:8080'
      }
    } as AutohandConfig;

    expect(getProviderConfig(config, 'llamacpp')).toMatchObject({
      baseUrl: 'http://localhost:8080',
      model: 'local'
    });
  });

  it('normalizes legacy vertex provider alias to vertexai before provider checks', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-config-'));
    const configPath = path.join(tempDir, 'config.json');

    await fs.writeJson(configPath, {
      provider: 'vertex',
      vertexai: {
        authToken: 'ya29.valid-token',
        projectId: 'autohand-project',
        model: 'zai-org/glm-5-maas'
      }
    });

    try {
      const config = await loadConfig(configPath);

      expect(config.provider).toBe('vertexai');
      expect(getProviderConfig(config)).toMatchObject({
        authToken: 'ya29.valid-token',
        projectId: 'autohand-project',
        model: 'zai-org/glm-5-maas'
      });
    } finally {
      await fs.remove(tempDir);
    }
  });
});
