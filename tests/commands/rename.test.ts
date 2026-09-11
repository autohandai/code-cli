/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { metadata, rename } from '../../src/commands/rename.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(stripAnsi(args.map(String).join(' ')));
  });
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/rename', () => {
  it('is registered as an implemented slash command', () => {
    expect(metadata).toMatchObject({ command: '/rename', implemented: true });
    expect(SLASH_COMMANDS.map((command) => command.command)).toContain('/rename');
  });

  it('renames the current session with the joined arguments', async () => {
    const renameCurrentSession = vi.fn().mockResolvedValue({ title: 'Caret fix' });
    const logs = captureLogs();
    await rename({
      sessionManager: { getCurrentSession: () => ({ metadata: {} }), renameCurrentSession } as never,
    }, ['Caret', 'fix']);

    expect(renameCurrentSession).toHaveBeenCalledWith('Caret fix');
    expect(logs.lines).toContain('Session renamed to "Caret fix".');
    logs.restore();
  });

  it('shows the current name and usage when called without a name', async () => {
    const renameCurrentSession = vi.fn();
    const logs = captureLogs();
    await rename({
      sessionManager: { getCurrentSession: () => ({ metadata: { title: 'Caret fix' } }), renameCurrentSession } as never,
    }, []);

    expect(renameCurrentSession).not.toHaveBeenCalled();
    expect(logs.lines.join('\n')).toContain('Current session name: Caret fix');
    expect(logs.lines.join('\n')).toContain('Usage: /rename <name>');
    logs.restore();
  });

  it('reports validation errors and a missing session without throwing', async () => {
    const logs = captureLogs();
    await rename({
      sessionManager: {
        getCurrentSession: () => ({ metadata: {} }),
        renameCurrentSession: vi.fn().mockRejectedValue(new Error('Session name cannot be empty.')),
      } as never,
    }, ['x']);
    await rename({ sessionManager: { getCurrentSession: () => null } as never }, ['x']);

    expect(logs.lines).toContain('Session name cannot be empty.');
    expect(logs.lines).toContain('No active session.');
    logs.restore();
  });
});
