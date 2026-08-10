/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isAutohandInferenceEnabled } from '../src/featureFlags.js';

describe('feature flags', () => {
  const originalFeatureEnv = process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
  const originalLegacyEnv = process.env.AUTOHAND_INFERENCE_ENABLED;

  afterEach(() => {
    if (originalFeatureEnv === undefined) delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    else process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = originalFeatureEnv;
    if (originalLegacyEnv === undefined) delete process.env.AUTOHAND_INFERENCE_ENABLED;
    else process.env.AUTOHAND_INFERENCE_ENABLED = originalLegacyEnv;
  });

  it('defaults autohand_inference to enabled now that the backend is deployed and verified', () => {
    delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    delete process.env.AUTOHAND_INFERENCE_ENABLED;

    expect(isAutohandInferenceEnabled()).toBe(true);
  });

  it('enables autohand_inference from config', () => {
    expect(isAutohandInferenceEnabled({
      features: { autohand_inference: true },
    })).toBe(true);
  });

  it('enables autohand_inference from explicit env', () => {
    process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = '1';

    expect(isAutohandInferenceEnabled()).toBe(true);
  });

  it('can still be explicitly disabled via config, despite the enabled-by-default fallback', () => {
    delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    delete process.env.AUTOHAND_INFERENCE_ENABLED;

    expect(isAutohandInferenceEnabled({
      features: { autohand_inference: false },
    })).toBe(false);
  });

  it('can still be explicitly disabled via env, despite the enabled-by-default fallback', () => {
    process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = 'false';

    expect(isAutohandInferenceEnabled()).toBe(false);
  });
});
