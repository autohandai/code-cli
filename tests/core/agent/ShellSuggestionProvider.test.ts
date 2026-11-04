/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => { vi.unstubAllEnvs(); });

  it('keeps unsent shell input local even when the environment selects Weka', async () => {
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    const complete = vi.fn();
    const history = vi.fn(() => [{ role: 'user' as const, content: 'Private draft' }]);
    const provider = new ShellSuggestionProvider({ runtime: { workspaceRoot: process.cwd() }, conversation: { history },
      getLlm: () => ({ complete }) as never, getParallelismLimit: () => 2 });
    expect(await provider.resolve('! bun')).toBe('! bun test');
    expect(complete).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

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

  it('uses deterministic local shell suggestions without calling the model', async () => {
    const complete = vi.fn();
    const provider = new ShellSuggestionProvider({
      runtime: { workspaceRoot: process.cwd() },
      conversation: { history: () => [] },
      getLlm: () => ({ complete }) as never,
      getParallelismLimit: () => 2,
    });

    await expect(provider.resolve('! bun')).resolves.toBe('! bun test');
    expect(complete).not.toHaveBeenCalled();
  });
});
