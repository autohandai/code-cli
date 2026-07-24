/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { BackgroundProcessRegistry } from '../core/agent/BackgroundProcessRegistry.js';

export interface PsCommandContext {
  backgroundProcessRegistry?: BackgroundProcessRegistry;
}

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

/**
 * List background shell processes the agent currently has running.
 */
export async function ps(ctx: PsCommandContext): Promise<string> {
  const entries = ctx.backgroundProcessRegistry?.list() ?? [];
  if (entries.length === 0) {
    return 'No background processes running.';
  }

  const lines = entries.map((entry) => (
    `${entry.id}  ${entry.command}  (pid ${entry.pid}, running ${formatElapsed(entry.startedAt)})`
  ));
  return `${chalk.bold('Background processes:')}\n${lines.join('\n')}`;
}

export const metadata = {
  command: '/ps',
  description: 'list background shell processes started by the agent',
  implemented: true,
};
