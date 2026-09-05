/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

describe('lifecycle slash dispatch', () => {
  it.each(['/deslop', '/tester'])('registers and dispatches %s help without starting a turn', async (command) => {
    const queueInstruction = vi.fn();
    const handler = new SlashCommandHandler({ workspaceRoot: '/repo', queueInstruction } as SlashCommandContext, SLASH_COMMANDS);
    expect(SLASH_COMMANDS.find(entry => entry.command === command)?.implemented).toBe(true);
    expect(await handler.handle(command, ['help'])).toContain(`Usage: ${command}`);
    expect(queueInstruction).not.toHaveBeenCalled();
  });
});
