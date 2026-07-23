/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import {
  getInteractionModeDescription,
  getInteractionModeIndicator,
  type InteractionMode,
} from '../core/agent/InteractionModeController.js';

export function formatInteractionModeChangeMessage(mode: InteractionMode): string {
  const indicator = getInteractionModeIndicator(mode) || '[EDIT]';
  return `${chalk.cyan(indicator)} ${chalk.cyan(getInteractionModeDescription(mode))}`;
}
