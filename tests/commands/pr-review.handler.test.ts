/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';

function createContext() {
  return {
    workspaceRoot: '/tmp/test',
    queueInstruction: undefined,
    sessionManager: {} as any,
    memoryManager: {} as any,
    llm: {} as any,
  };
}

describe('/pr-review slash handler', () => {
  it('is registered in the slash command registry', () => {
    const commands = SLASH_COMMANDS.map(command => command.command);
    expect(commands).toContain('/pr-review');
  });

  it('dispatches to the pr review command', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx as any, SLASH_COMMANDS);

    const result = await handler.handle('/pr-review', ['482']);

    expect(typeof result).toBe('string');
    expect(result).toContain('gh pr view 482');
    expect(result).toContain('gh pr diff 482');
  });
});
