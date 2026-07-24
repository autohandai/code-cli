/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { formatBackgroundProcessEntry } from '../core/agent/BackgroundProcessRegistry.js';
import type { BackgroundProcessEntry, BackgroundProcessRegistry } from '../core/agent/BackgroundProcessRegistry.js';

export interface StopCommandContext {
  backgroundProcessRegistry?: BackgroundProcessRegistry;
}

function formatEntryList(entries: BackgroundProcessEntry[]): string {
  return entries.map(formatBackgroundProcessEntry).join('\n');
}

/**
 * Stop a background shell process the agent started.
 */
export async function stop(ctx: StopCommandContext, args: string[] = []): Promise<string> {
  const registry = ctx.backgroundProcessRegistry;
  const entries = registry?.list() ?? [];
  const target = args[0]?.trim();

  if (!target) {
    if (entries.length === 0) {
      return 'No background processes running.';
    }
    if (entries.length > 1) {
      return `Multiple background processes are running. Specify which to stop:\n${formatEntryList(entries)}`;
    }
    const result = await registry!.stop(entries[0].id);
    return result.message;
  }

  const id = Number(target);
  if (!Number.isInteger(id) || id <= 0) {
    return `"${target}" is not a valid process index. Run /ps to see running processes.`;
  }
  if (!registry) {
    return `No background process with index ${id}.`;
  }
  const result = await registry.stop(id);
  return result.message;
}

export const metadata = {
  command: '/stop',
  description: 'stop a background shell process started by the agent',
  implemented: true,
};
