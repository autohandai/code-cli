/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  CategoryList,
  CategorySelector,
  CATEGORY_LABELS,
  showCategorySelector,
} from '../../../src/import/ui/CategorySelector.js';
import type { ImportCategory } from '../../../src/import/types.js';

function makeEntries(): [ImportCategory, { count: number; description: string }][] {
  return [
    ['sessions', { count: 47, description: '47 sessions' }],
    ['settings', { count: 1, description: '1 config file' }],
    ['skills', { count: 3, description: '3 skills' }],
    ['memory', { count: 0, description: '0 items' }],
  ];
}

function makeCategories(): Map<ImportCategory, { count: number; description: string }> {
  return new Map(makeEntries());
}

// ---------------------------------------------------------------
// CategoryList (presentational — safe for ink-testing-library)
// ---------------------------------------------------------------

describe('CategoryList', () => {
  it('should render all categories with counts', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>(entries.map(([cat]) => cat));
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    expect(output).toContain('Sessions');
    expect(output).toContain('47 sessions');
    expect(output).toContain('Settings');
    expect(output).toContain('1 config file');
    expect(output).toContain('Skills');
    expect(output).toContain('3 skills');
    expect(output).toContain('Memory');
    expect(output).toContain('0 items');
  });

  it('should render checked checkboxes when all are selected', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>(entries.map(([cat]) => cat));
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    // Count [x] occurrences — should match entries count
    const checkedCount = (output.match(/\[x\]/g) ?? []).length;
    expect(checkedCount).toBe(entries.length);
  });

  it('should render unchecked checkboxes when none are selected', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>();
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    const uncheckedCount = (output.match(/\[ \]/g) ?? []).length;
    expect(uncheckedCount).toBe(entries.length);
    expect(output).not.toContain('[x]');
  });

  it('should render instruction hints', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>();
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    expect(output).toContain('Select categories to import');
    expect(output).toContain('space to toggle');
    expect(output).toContain('enter to confirm');
    expect(output).toContain('esc to cancel');
  });

  it('should highlight cursor row with > prefix', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>();
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    // First row should have '>' prefix
    expect(output).toContain('>');
  });

  it('should highlight a different cursor row', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>();
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={2} checked={checked} />,
    );
    const output = lastFrame();

    // The output should contain both > prefixed and non-prefixed rows
    const lines = output.split('\n');
    const cursorLines = lines.filter((l: string) => l.includes('>'));
    expect(cursorLines.length).toBeGreaterThan(0);
  });

  it('should handle single category', () => {
    const entries: [ImportCategory, { count: number; description: string }][] = [
      ['sessions', { count: 5, description: '5 sessions' }],
    ];
    const checked = new Set<ImportCategory>(['sessions']);
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    expect(output).toContain('Sessions');
    expect(output).toContain('5 sessions');
    expect(output).toContain('[x]');
  });

  it('should handle empty entries', () => {
    const entries: [ImportCategory, { count: number; description: string }][] = [];
    const checked = new Set<ImportCategory>();
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    // Should still render the header
    expect(output).toContain('Select categories to import');
  });

  it('should render mixed checked/unchecked state', () => {
    const entries = makeEntries();
    const checked = new Set<ImportCategory>(['sessions', 'skills']);
    const { lastFrame } = render(
      <CategoryList entries={entries} cursor={0} checked={checked} />,
    );
    const output = lastFrame();

    const checkedCount = (output.match(/\[x\]/g) ?? []).length;
    const uncheckedCount = (output.match(/\[ \]/g) ?? []).length;
    expect(checkedCount).toBe(2);
    expect(uncheckedCount).toBe(2);
  });
});

// ---------------------------------------------------------------
// CategorySelector (interactive — tested via createElement/exports)
// ---------------------------------------------------------------

describe('CategorySelector', () => {
  it('should be exported as a function component', () => {
    expect(typeof CategorySelector).toBe('function');
  });

  it('should accept expected props via React.createElement', () => {
    const cats = makeCategories();
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const element = React.createElement(CategorySelector, {
      categories: cats,
      onSelect,
      onCancel,
    });

    expect(element).toBeDefined();
    expect(element.type).toBe(CategorySelector);
    expect(element.props.categories).toBe(cats);
    expect(element.props.onSelect).toBe(onSelect);
    expect(element.props.onCancel).toBe(onCancel);
  });
});

// ---------------------------------------------------------------
// CATEGORY_LABELS
// ---------------------------------------------------------------

describe('CATEGORY_LABELS', () => {
  it('should have labels for all import categories', () => {
    expect(CATEGORY_LABELS.sessions).toBe('Sessions');
    expect(CATEGORY_LABELS.settings).toBe('Settings');
    expect(CATEGORY_LABELS.skills).toBe('Skills');
    expect(CATEGORY_LABELS.memory).toBe('Memory');
    expect(CATEGORY_LABELS.mcp).toBe('MCP Servers');
    expect(CATEGORY_LABELS.hooks).toBe('Hooks');
  });

  it('should have exactly 6 labels', () => {
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------
// showCategorySelector
// ---------------------------------------------------------------

describe('showCategorySelector', () => {
  it('should be exported as a function', () => {
    expect(typeof showCategorySelector).toBe('function');
  });

  it('should return null for non-TTY environments', async () => {
    const originalIsTTY = process.stdout.isTTY;
    try {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const cats = makeCategories();
      const result = await showCategorySelector(cats);
      expect(result).toBeNull();
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });
});
