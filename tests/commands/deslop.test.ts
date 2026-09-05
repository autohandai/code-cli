/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deslop } from '../../src/commands/deslop.js';

afterEach(() => vi.restoreAllMocks());

describe('/deslop', () => {
  it('scopes cleanup to the current diff and requires behavior evidence before editing', async () => {
    const result = await deslop({ workspaceRoot: '/repo', isNonInteractive: true });

    expect(result).toContain('Target: current working-tree diff');
    expect(result).toContain('characterization test');
    expect(result).toContain('before changing production code');
    expect(result).toContain('Preserve public APIs');
    expect(result).toContain('code-cleaner');
    expect(result).toContain('tester');
    expect(result).toContain('Do not commit');
  });

  it('queues an explicit user scope without discarding the original request', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const queueInstruction = vi.fn();

    expect(await deslop({ workspaceRoot: '/repo', queueInstruction }, ['src/auth', 'remove redundant wrappers'])).toBeNull();
    expect(queueInstruction.mock.calls[0]?.[0]).toContain('src/auth remove redundant wrappers');
  });

  it('returns help without starting cleanup', async () => {
    const queueInstruction = vi.fn();
    expect(await deslop({ workspaceRoot: '/repo', queueInstruction }, ['help'])).toContain('Usage: /deslop');
    expect(queueInstruction).not.toHaveBeenCalled();
  });
});
