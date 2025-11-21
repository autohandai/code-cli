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
    promptModelSelection: vi.fn().mockResolvedValue(undefined),
    createAgentsFile: vi.fn().mockResolvedValue(undefined),
    llm: {
      complete: vi.fn().mockResolvedValue({ id: 'test', created: Date.now(), content: '', raw: {} }),
      setDefaultModel: vi.fn()
    }
  };
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: '/model', description: 'choose model', implemented: true },
  { command: '/init', description: 'init agents', implemented: true }
];

describe('SlashCommandHandler', () => {
  it('invokes model selection for /model', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);

    const result = await handler.handle('/model');

    expect(result).toBeNull();
    expect(ctx.promptModelSelection).toHaveBeenCalledTimes(1);
  });

  it('calls init for /init', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handler.handle('/init');

    expect(result).toBeNull();
    expect(ctx.createAgentsFile).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('falls back to default for unknown commands', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx, DEFAULT_COMMANDS);
    const dummy = '/does-not-exist';

    const result = await handler.handle(dummy);

    expect(result).toBeNull();
    expect(ctx.promptModelSelection).not.toHaveBeenCalled();
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
