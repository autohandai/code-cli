/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getFeatureState } from '../../features/featureRegistry.js';
import type { LoadedConfig } from '../../types.js';

export const CLI_LANES_FEATURE_ID = 'cli_lanes';

/** Lanes that may run at the same time; each one also takes a session thread. */
export const MAX_ACTIVE_LANES = 4;

/** Lanes kept in the list, running or finished, before the oldest finished one is dropped. */
export const MAX_RETAINED_LANES = 8;

export function isCliLanesEnabled(config?: LoadedConfig | null): boolean {
  if (!config) return false;
  return getFeatureState(config, CLI_LANES_FEATURE_ID)?.enabled ?? false;
}
