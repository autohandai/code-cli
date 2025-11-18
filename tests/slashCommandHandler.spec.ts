/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { SlashCommandHandler } from '../src/core/slashCommandHandler.js';
import type { SlashCommand } from '../src/core/slashCommands.js';

function createContext() {
  return {
    listWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
    printGitDiff: vi.fn(),
    undoLastMutation: vi.fn().mockResolvedValue(undefined),
    promptModelSelection: vi.fn().mockResolvedValue(undefined),
    promptApprovalMode: vi.fn().mockResolvedValue(undefined),
    createAgentsFile: vi.fn().mockResolvedValue(undefined),
    resetConversation: vi.fn()
  };
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: '/ls', description: 'list files', implemented: true },
  { command: '/review', description: 'review changes', implemented: true }
];

describe('SlashCommandHandler', () => {
  it('runs workspace listing for /ls', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);

    const result = await handler.handle('/ls');

    expect(result).toBeNull();
    expect(ctx.listWorkspaceFiles).toHaveBeenCalledTimes(1);
  });

  it('returns canned review prompt for /review', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);

    const result = await handler.handle('/review');

    expect(result).toMatch(/Review my current changes/);
  });

  it('falls back to default for unknown commands', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);
    const dummy = '/does-not-exist';

    const result = await handler.handle(dummy);

    expect(result).toBe(dummy);
    expect(ctx.listWorkspaceFiles).not.toHaveBeenCalled();
  });

  it('references PRD for unimplemented commands', async () => {
    const ctx = createContext();
    const commands: SlashCommand[] = [
      { command: '/help', description: 'help', implemented: false, prd: 'docs/prd/slash-help.md' }
    ];
    const handler = new SlashCommandHandler(ctx, commands);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handler.handle('/help');

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not implemented'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('docs/prd/slash-help.md'));
    spy.mockRestore();
  });
});
