/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface QueueBlockItem {
  marker: string;
  objectiveInput: string;
  lineIndex: number;
}

export function parseQueueBlockItems(input: string): QueueBlockItem[] | null {
  const lines = input.split(/\r?\n/);
  const items: QueueBlockItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const bracket = trimmed.match(/^\[(\d+)\]\s+(.+)$/);
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    const match = bracket ?? numbered;
    if (!match) continue;
    items.push({
      marker: match[1],
      objectiveInput: match[2].trim(),
      lineIndex: i,
    });
  }

  return items.length > 1 ? items : null;
}
