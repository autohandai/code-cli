/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AutohandConfig } from './types.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

/**
 * Defaults to enabled: the autohandai backend (api + inference entitlement checking) is fully
 * deployed and verified in production, so there's no longer a rollout reason to gate ordinary
 * users out by default. Config and env can still force it off explicitly.
 */
export function isAutohandInferenceEnabled(
  config?: Pick<AutohandConfig, 'features'> | null,
): boolean {
  const configValue = parseBooleanFlag(config?.features?.autohand_inference);
  if (configValue !== undefined) return configValue;

  const explicitEnv =
    parseBooleanFlag(process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE) ??
    parseBooleanFlag(process.env.AUTOHAND_INFERENCE_ENABLED);
  if (explicitEnv !== undefined) return explicitEnv;

  return true;
}
