/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../src/core/toolManager.js';
import { getToolCategory } from '../src/core/toolFilter.js';

describe('orchestration tools', () => {
  it('includes skill and sleep in default tool definitions', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(names.has('skill')).toBe(true);
    expect(names.has('sleep')).toBe(true);
  });

  it('categorizes skill and sleep as meta tools', () => {
    expect(getToolCategory('skill')).toBe('meta');
    expect(getToolCategory('sleep')).toBe('meta');
  });
});
