/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SlashCommandHandler } from '../src/core/slashCommandHandler.js';
import type { SlashCommand } from '../src/core/slashCommands.js';
import type { ShowModalOptions } from '../src/ui/ink/components/Modal.js';

const mockIde = vi.fn();
vi.mock('../src/commands/ide.js', () => ({
  ide: mockIde,
}));

const mockShowModal = vi.fn();

vi.mock('../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
}));

const mockSquad = vi.fn();
vi.mock('../src/commands/squad.js', () => ({
  squad: mockSquad,
}));

function createContext() {
  return {
    promptModelSelection: vi.fn().mockResolvedValue(undefined),
    createAgentsFile: vi.fn().mockResolvedValue(undefined),
    config: {
      configPath: `/tmp/autohand-slash-handler-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
      provider: 'openrouter',
      api: {
        baseUrl: 'http://127.0.0.1:9',
      },
      features: {
        usageV2: false,
        slashGoal: false,
      },
    },
    workspaceRoot: '/tmp/workspace',
    onBeforeModal: vi.fn(),
    onAfterModal: vi.fn(),
    refreshFeatureGatedTools: vi.fn(),
    llm: {
      complete: vi.fn().mockResolvedValue({ id: 'test', created: Date.now(), content: '', raw: {} }),
      setDefaultModel: vi.fn()
    }
  };
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: '/model', description: 'choose model', implemented: true },
  { command: '/init', description: 'init agents', implemented: true },
  { command: '/about', description: 'about', implemented: true },
  { command: '/ide', description: 'connect ide', implemented: true },
  { command: '/squad', description: 'open squad', implemented: true },
];

describe('SlashCommandHandler', () => {
  beforeEach(() => {
    mockShowModal.mockReset();
  });

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

  it('passes modal lifecycle hooks through to /ide', async () => {
    const ctx = createContext();
    mockIde.mockResolvedValueOnce(null);
    const handler = new SlashCommandHandler(ctx as any, DEFAULT_COMMANDS);

    const result = await handler.handle('/ide');

    expect(result).toBeNull();
    expect(mockIde).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/tmp/workspace',
      onBeforeModal: ctx.onBeforeModal,
      onAfterModal: ctx.onAfterModal,
    }));
  });

  it('pauses the active UI around the interactive /experiments list modal', async () => {
    const ctx = createContext();
    mockShowModal.mockImplementation(async (options: ShowModalOptions) => {
      options.onToggle?.({ label: 'Usage v2', value: 'usage_v2' }, true);
      return { label: 'Usage v2', value: 'usage_v2' };
    });
    const handler = new SlashCommandHandler(ctx as any, [
      ...DEFAULT_COMMANDS,
      { command: '/experiments', description: 'experiments', implemented: true },
    ]);

    const result = await handler.handle('/experiments', ['list']);

    expect(result).toBe('Enabled usage_v2.');
    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
    expect(ctx.refreshFeatureGatedTools).toHaveBeenCalledTimes(1);
    expect(mockShowModal).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Experiments'),
      multiSelect: true,
    }));
    expect(ctx.config.features.usageV2).toBe(true);
  });

  it('refreshes feature-gated tools after non-modal /experiments toggles', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx as any, [
      ...DEFAULT_COMMANDS,
      { command: '/experiments', description: 'experiments', implemented: true },
    ]);

    const result = await handler.handle('/experiments', ['enable', 'slash_goal']);

    expect(result).toBe('Enabled slash_goal.');
    expect(ctx.refreshFeatureGatedTools).toHaveBeenCalledTimes(1);
    expect(ctx.onBeforeModal).not.toHaveBeenCalled();
    expect(ctx.onAfterModal).not.toHaveBeenCalled();
  });

  it('returns /about output instead of printing through the active composer', async () => {
    const ctx = createContext();
    const handler = new SlashCommandHandler(ctx as any, DEFAULT_COMMANDS);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handler.handle('/about');

    expect(result).toContain('Autohand');
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.onBeforeModal).not.toHaveBeenCalled();
    expect(ctx.onAfterModal).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes auth config into /about output', async () => {
    const ctx = {
      ...createContext(),
      config: {
        configPath: '/tmp/autohand-config.json',
        auth: {
          token: 'test-token',
          user: {
            id: 'user-1',
            email: 'igor@example.com',
            name: 'Igor Costa',
          },
        },
      },
    };
    const handler = new SlashCommandHandler(ctx as any, DEFAULT_COMMANDS);

    const result = await handler.handle('/about');

    expect(result).toContain('Hey Igor');
    expect(result).toContain('/usage');
  });

  it('passes workspace and args through to /squad', async () => {
    const ctx = createContext();
    mockSquad.mockResolvedValueOnce('Autohand Squad is ready.');
    const handler = new SlashCommandHandler(ctx as any, DEFAULT_COMMANDS);

    const result = await handler.handle('/squad', ['--port', '19999']);

    expect(result).toBe('Autohand Squad is ready.');
    expect(mockSquad).toHaveBeenCalledWith(
      { workspaceRoot: '/tmp/workspace', config: ctx.config },
      ['--port', '19999'],
    );
  });

  it('pauses the active UI around /statusline', async () => {
    const ctx = {
      ...createContext(),
      refreshStatusLine: vi.fn(),
      config: {
        configPath: '/tmp/autohand-config.json',
        provider: 'openrouter',
      },
    };
    const handler = new SlashCommandHandler(ctx as any, [
      ...DEFAULT_COMMANDS,
      { command: '/statusline', description: 'configure status line', implemented: true },
    ]);

    const result = await handler.handle('/statusline');

    expect(result).toBeNull();
    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
    expect(ctx.refreshStatusLine).toHaveBeenCalledTimes(1);
  });
});
