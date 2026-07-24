/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { formatBackgroundProcessEntry } from '../core/agent/BackgroundProcessRegistry.js';
import type { BackgroundProcessRegistry } from '../core/agent/BackgroundProcessRegistry.js';

export interface PsCommandContext {
  backgroundProcessRegistry?: BackgroundProcessRegistry;
}

/**
 * List background shell processes the agent currently has running.
 */
export async function ps(ctx: PsCommandContext): Promise<string> {
  const entries = ctx.backgroundProcessRegistry?.list() ?? [];
  if (entries.length === 0) {
    return 'No background processes running.';
  }

  const lines = entries.map(formatBackgroundProcessEntry);
  return `${chalk.bold('Background processes:')}\n${lines.join('\n')}`;
}

export const metadata = {
  command: '/ps',
  description: 'list background shell processes started by the agent',
  implemented: true,
};
