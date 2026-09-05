/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../../types.js';

interface GoalActivationContext {
  config?: Pick<LoadedConfig, 'agent'>;
  isNonInteractive?: boolean;
  setInteractionMode?: (mode: 'automode') => void;
}

export function activateGoalAutoMode(context: GoalActivationContext): void {
  if (context.isNonInteractive || context.config?.agent?.goalAutoMode === false) return;
  context.setInteractionMode?.('automode');
}
