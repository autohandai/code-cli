/** @license Apache-2.0 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
const show = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../src/ui/ink/components/UsageScreen.js', () => ({ showUsageScreen: show }));
import { usage } from '../../src/commands/usage.js';
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
afterEach(() => {
  for (const [stream, descriptor] of [[process.stdin, stdinTTY], [process.stdout, stdoutTTY]] as const) {
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else Reflect.deleteProperty(stream, 'isTTY');
  }
  vi.clearAllMocks();
});

describe('interactive usage command', () => {
  it('pauses the composer and restores it even when the dashboard fails', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const before = vi.fn(); const after = vi.fn();
    const ctx = { onBeforeModal: before, onAfterModal: after, isFeatureEnabled: () => true, workspaceRoot: '/work',
      sessionManager: { listSessions: async () => [], getCurrentSession: () => undefined }, model: 'moa' } as unknown as SlashCommandContext;
    show.mockRejectedValueOnce(new Error('render failed'));
    await expect(usage(ctx)).rejects.toThrow('render failed');
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
