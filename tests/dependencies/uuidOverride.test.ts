/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };

describe('dependency overrides', () => {
  it('forces node-notifier transitive uuid away from the deprecated v8 line', () => {
    expect(packageJson.dependencies['node-notifier']).toBeDefined();
    expect(packageJson.overrides?.uuid).toMatch(/^\^?11\./);
  });
});
