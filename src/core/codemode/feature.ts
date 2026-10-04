/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getFeatureState } from '../../features/featureRegistry.js';
import type { LoadedConfig } from '../../types.js';

export const CODE_MODE_FEATURE_ID = 'code_mode';
export const CODE_MODE_TOOL_NAME = 'run_tool_script' as const;

export function isCodeModeEnabled(config?: LoadedConfig | null): boolean {
  if (!config) return false;
  return getFeatureState(config, CODE_MODE_FEATURE_ID)?.enabled ?? false;
}
