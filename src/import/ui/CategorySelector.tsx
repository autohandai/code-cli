/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput, render, type Instance } from 'ink';
import { I18nProvider } from '../../ui/i18n/index.js';
import type { ImportCategory } from '../types.js';

/**
 * Human-readable labels for each import category.
 */
export const CATEGORY_LABELS: Record<ImportCategory, string> = {
  sessions: 'Sessions',
  settings: 'Settings',
  skills: 'Skills',
  memory: 'Memory',
  mcp: 'MCP Servers',
  hooks: 'Hooks',
};

/**
 * Props for the presentational CategoryList component.
 */
export interface CategoryListProps {
  /** Ordered entries to display */
  entries: [ImportCategory, { count: number; description: string }][];
  /** Currently highlighted row index */
  cursor: number;
  /** Set of currently checked categories */
  checked: Set<ImportCategory>;
}

/**
 * Pure presentational component that renders the category list.
 * Does NOT use `useInput`, making it safe for ink-testing-library.
 */
export function CategoryList({ entries, cursor, checked }: CategoryListProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">Select categories to import:</Text>
      <Text color="gray">
        {'  (space to toggle, a to toggle all, enter to confirm, esc to cancel)'}
      </Text>
      <Text>{''}</Text>

      {entries.map(([cat, info], index) => {
        const isActive = index === cursor;
        const isChecked = checked.has(cat);
        const label = CATEGORY_LABELS[cat] ?? cat;
        const checkbox = isChecked ? '[x]' : '[ ]';
        const prefix = isActive ? '> ' : '  ';

        return (
          <Text key={cat} color={isActive ? 'cyan' : undefined}>
            {prefix}{checkbox} {label.padEnd(12)} ({info.description})
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Props for the interactive CategorySelector component.
 */
export interface CategorySelectorProps {
  /** Map of categories to their count and description */
  categories: Map<ImportCategory, { count: number; description: string }>;
  /** Callback invoked with selected categories when user confirms */
  onSelect: (selected: ImportCategory[]) => void;
  /** Callback invoked when user cancels (Esc) */
  onCancel: () => void;
}

/**
 * Interactive checkbox multi-select for choosing import categories.
 *
 * - Arrow keys navigate up/down
 * - Space toggles the current item
 * - 'a' toggles all on/off
 * - Enter confirms selection
 * - Esc cancels
 *
 * All categories start selected by default.
 */
export function CategorySelector({ categories, onSelect, onCancel }: CategorySelectorProps) {
  const entries = useMemo(() => Array.from(categories.entries()), [categories]);

  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<ImportCategory>>(() => {
    // All categories start selected by default
    return new Set(entries.map(([cat]) => cat));
  });

  const toggle = useCallback((cat: ImportCategory) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setChecked((prev) => {
      const allKeys = entries.map(([cat]) => cat);
      // If all are selected, deselect all; otherwise select all
      if (prev.size === allKeys.length) {
        return new Set<ImportCategory>();
      }
      return new Set(allKeys);
    });
  }, [entries]);

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSelect(Array.from(checked));
      return;
    }

    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : entries.length - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((prev) => (prev < entries.length - 1 ? prev + 1 : 0));
      return;
    }

    // Space toggles current
    if (char === ' ' && entries.length > 0) {
      const [cat] = entries[cursor]!;
      toggle(cat);
      return;
    }

    // 'a' toggles all
    if (char === 'a') {
      toggleAll();
      return;
    }
  });

  return <CategoryList entries={entries} cursor={cursor} checked={checked} />;
}

// ---------------------------------------------------------------
// Unmount helper (mirrors Modal.tsx pattern)
// ---------------------------------------------------------------

function unmountAndResolve<T>(
  instance: Instance,
  value: T,
  resolve: (value: T) => void,
): void {
  instance.unmount();
  process.nextTick(() => resolve(value));
}

/**
 * Show an interactive category selector and return the user's selection.
 * Returns null if the user cancels (Esc) or if stdout is not a TTY.
 */
export async function showCategorySelector(
  categories: Map<ImportCategory, { count: number; description: string }>,
): Promise<ImportCategory[] | null> {
  if (!process.stdout.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <CategorySelector
          categories={categories}
          onSelect={(selected) => {
            if (completed) return;
            completed = true;
            unmountAndResolve(instance, selected, resolve);
          }}
          onCancel={() => {
            if (completed) return;
            completed = true;
            unmountAndResolve(instance, null, resolve);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false },
    );
  });
}
