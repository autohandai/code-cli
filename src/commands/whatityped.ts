/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { getTypedMessageHistory, type TypedMessageHistory } from '../session/TypedMessageHistory.js';
import { showModal } from '../ui/ink/components/Modal.js';

export const metadata = {
  command: '/whatityped',
  description: 'Choose a previously typed message from any directory',
  implemented: true,
};

export async function whatityped(
  ctx: Pick<SlashCommandContext, 'setComposerInput' | 'onBeforeModal' | 'onAfterModal'>,
  history: TypedMessageHistory = getTypedMessageHistory(),
): Promise<string | null> {
  if (!ctx.setComposerInput) return 'Command /whatityped requires an interactive composer.';
  await history.refresh();
  const entries = history.entries();
  if (entries.length === 0) return 'No typed messages yet. Submitted messages are saved across directories.';

  await ctx.onBeforeModal?.();
  try {
    const selected = await showModal({
      title: 'What I typed · all directories',
      options: entries.map(entry => ({
        value: entry.id,
        label: entry.text.replace(/\s+/g, ' ').slice(0, 120),
        description: `${entry.cwd} · ${entry.createdAt.slice(0, 16).replace('T', ' ')} UTC`,
        preview: entry.text.slice(0, 1000),
      })),
      hint: '↑↓ select · enter loads into composer · esc cancels',
    });
    const entry = entries.find(item => item.id === selected?.value);
    if (entry) ctx.setComposerInput(entry.text);
    return null;
  } finally {
    await ctx.onAfterModal?.();
  }
}
