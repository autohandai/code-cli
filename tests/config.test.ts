/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getProviderConfig } from '../src/config';
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
});
