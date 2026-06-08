/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getFeatureState } from '../features/featureRegistry.js';
import type { LoadedConfig } from '../types.js';

export const GOAL_FEATURE_ID = 'slash_goal';

export const GOAL_FEATURE_DISABLED_MESSAGE =
  'The /goal feature is behind slash_goal. Run /experiments enable slash_goal, then try again.';

export function isGoalFeatureEnabled(config?: LoadedConfig | null): boolean {
  if (!config) return false;
  return getFeatureState(config, GOAL_FEATURE_ID)?.enabled ?? false;
}

export function resolveGoalFeatureEnabled(
  config?: LoadedConfig | null,
  isFeatureEnabled?: (key: string, localDefault?: boolean) => boolean
): boolean {
  const localDefault = isGoalFeatureEnabled(config);
  return isFeatureEnabled?.(GOAL_FEATURE_ID, localDefault) ?? localDefault;
}
