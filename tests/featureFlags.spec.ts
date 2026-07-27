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
  const originalFeatureList = process.env.AUTOHAND_FEATURES;

  afterEach(() => {
    if (originalFeatureEnv === undefined) delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    else process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = originalFeatureEnv;
    if (originalLegacyEnv === undefined) delete process.env.AUTOHAND_INFERENCE_ENABLED;
    else process.env.AUTOHAND_INFERENCE_ENABLED = originalLegacyEnv;
    if (originalFeatureList === undefined) delete process.env.AUTOHAND_FEATURES;
    else process.env.AUTOHAND_FEATURES = originalFeatureList;
  });

  it('keeps autohand_inference disabled by default', () => {
    delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    delete process.env.AUTOHAND_INFERENCE_ENABLED;
    delete process.env.AUTOHAND_FEATURES;

    expect(isAutohandInferenceEnabled()).toBe(false);
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

  it('enables autohand_inference from AUTOHAND_FEATURES list', () => {
    process.env.AUTOHAND_FEATURES = 'other,autohand_inference';

    expect(isAutohandInferenceEnabled()).toBe(true);
  });
});
