/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import type { InteractionMode } from './InteractionModeController.js';
import type { LoadedConfig } from '../../types.js';

interface GoalActivationContext {
  config?: Pick<LoadedConfig, 'agent' | 'permissions'>;
  isNonInteractive?: boolean;
  getInteractionMode?: () => InteractionMode;
  setInteractionMode?: (mode: InteractionMode) => void;
  permissionManager?: Pick<PermissionManager, 'getMode'>;
}

export function activateGoalAutoMode(context: GoalActivationContext): () => void {
  const noop = (): void => {};
  if (context.isNonInteractive || context.config?.agent?.goalAutoMode === false) return noop;
  const permissionMode = context.permissionManager?.getMode() ?? context.config?.permissions?.mode;
  if (permissionMode === 'restricted') return noop;
  const previous = context.getInteractionMode?.();
  if (previous === 'automode') return noop;
  context.setInteractionMode?.('automode');
  let rolledBack = false;
  return () => {
    if (rolledBack) return;
    rolledBack = true;
    if (previous !== undefined && context.getInteractionMode?.() === 'automode') context.setInteractionMode?.(previous);
  };
}
