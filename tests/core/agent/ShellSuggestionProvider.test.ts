/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ShellSuggestionProvider,
  normalizeShellSuggestionFromLlm,
} from '../../../src/core/agent/ShellSuggestionProvider.js';

describe('normalizeShellSuggestionFromLlm', () => {
  it('normalizes a bare command into composer shell syntax', () => {
    expect(normalizeShellSuggestionFromLlm('bun test tests/config.test.ts', '! bun')).toBe(
      '! bun test tests/config.test.ts',
    );
  });

  it('keeps a valid shell-prefixed completion', () => {
    expect(normalizeShellSuggestionFromLlm('! git status --short', '! git')).toBe('! git status --short');
  });

  it('rejects completions that do not extend the partial input', () => {
    expect(normalizeShellSuggestionFromLlm('npm install', '! bun')).toBeNull();
  });

  it('rejects completions equal to the partial input', () => {
    expect(normalizeShellSuggestionFromLlm('! bun', '! bun')).toBeNull();
  });
});

describe('ShellSuggestionProvider', () => {
  it('does not call the model for non-shell input', async () => {
    const complete = vi.fn();
    const provider = new ShellSuggestionProvider({
      runtime: { workspaceRoot: process.cwd() },
      conversation: { history: () => [] },
      getLlm: () => ({ complete }) as never,
      getParallelismLimit: () => 2,
    });

    await expect(provider.resolve('regular prompt')).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});
