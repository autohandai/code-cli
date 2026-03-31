/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../src/core/toolManager.js';
import { getToolCategory } from '../src/core/toolFilter.js';

describe('Worktree session tools', () => {
  it('includes enter_worktree in DEFAULT_TOOL_DEFINITIONS', () => {
    const def = DEFAULT_TOOL_DEFINITIONS.find((item) => item.name === 'enter_worktree');
    expect(def).toBeDefined();
    expect(def!.parameters?.properties).toHaveProperty('name');
  });

  it('includes exit_worktree in DEFAULT_TOOL_DEFINITIONS', () => {
    const def = DEFAULT_TOOL_DEFINITIONS.find((item) => item.name === 'exit_worktree');
    expect(def).toBeDefined();
    expect(def!.parameters?.properties).toHaveProperty('keep');
  });

  it('categorizes enter_worktree as meta', () => {
    expect(getToolCategory('enter_worktree')).toBe('meta');
  });

  it('categorizes exit_worktree as meta', () => {
    expect(getToolCategory('exit_worktree')).toBe('meta');
  });
});
