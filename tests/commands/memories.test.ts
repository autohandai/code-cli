/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memories, metadata, type MemoriesCommandContext } from '../../src/commands/memories.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import type { MemoriesOverview } from '../../src/ui/ink/components/MemoriesScreen.js';
import type { MemoriesScreenResult } from '../../src/ui/ink/memoriesScreenModel.js';
import type { LoadedConfig } from '../../src/types.js';

const PROJECT = { level: 'project' as const, directory: '/repo/.autohand/memory', entries: 3 };
const USER = { level: 'user' as const, directory: '/data/autohand/memory', entries: 5 };

function setup(options: {
  config?: Partial<LoadedConfig>;
  result?: MemoriesScreenResult;
  sharedProject?: boolean;
  interactive?: boolean;
} = {}) {
  const config = { configPath: '/data/autohand/config.json', agent: { maxIterations: 9 }, ...options.config } as LoadedConfig;
  const memoryManager = {
    describeLocalStores: vi.fn(async () => [PROJECT, USER]),
    resetLocalStore: vi.fn(async (level: 'project' | 'user') => (level === 'project' ? PROJECT.entries : USER.entries)),
    hasSharedProjectMemory: vi.fn(() => options.sharedProject ?? false),
  };
  const show = vi.fn(async (_overview: MemoriesOverview) => options.result ?? { kind: 'cancel' as const });
  const save = vi.fn(async (_config: LoadedConfig) => {});
  const ctx: MemoriesCommandContext = { config, memoryManager, show, save, interactive: options.interactive ?? true };
  return { ctx, config, memoryManager, show, save };
}

describe('/memories command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('is registered as a slash command', () => {
    expect(metadata).toMatchObject({ command: '/memories', implemented: true });
    expect(SLASH_COMMANDS.some((command) => command.command === '/memories')).toBe(true);
  });

  it('opens the screen with the saved setting, the local stores and the reset plan', async () => {
    const { ctx, show } = setup({ config: { agent: { autoMemory: false }, sync: { enabled: true } }, sharedProject: true });

    await memories(ctx);

    expect(show).toHaveBeenCalledWith({
      settings: { use: true, generate: false },
      configPath: '/data/autohand/config.json',
      stores: [PROJECT, USER],
      userSynced: true,
      resetPlan: { deletes: [PROJECT], keepsSyncedUser: true, keepsSharedProject: true },
    });
  });

  it('changes nothing when the screen is cancelled', async () => {
    const { ctx, config, save, memoryManager } = setup({ result: { kind: 'cancel' } });

    await expect(memories(ctx)).resolves.toBeNull();

    expect(save).not.toHaveBeenCalled();
    expect(memoryManager.resetLocalStore).not.toHaveBeenCalled();
    expect(config.agent).toEqual({ maxIterations: 9 });
  });

  it('persists a changed toggle, applies it to the running config and reports where it was saved', async () => {
    const { ctx, config, save } = setup({ result: { kind: 'save', settings: { use: true, generate: false } } });

    const output = await memories(ctx);

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    expect(saved).not.toBe(config);
    expect(saved.agent).toEqual({ maxIterations: 9, autoMemory: false, useMemories: true });
    expect(config.agent).toEqual({ maxIterations: 9, autoMemory: false, useMemories: true });
    expect(output).toBe('Generate memories is now off. Saved to /data/autohand/config.json.');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('persists Use memories off while Generate memories stays on, and reports only what changed', async () => {
    const { ctx, config, save } = setup({ result: { kind: 'save', settings: { use: false, generate: true } } });

    const output = await memories(ctx);

    expect(save.mock.calls[0][0].agent).toEqual({ maxIterations: 9, autoMemory: true, useMemories: false });
    expect(config.agent).toEqual({ maxIterations: 9, autoMemory: true, useMemories: false });
    expect(output).toBe('Use memories is now off. Saved to /data/autohand/config.json.');
  });

  it('saves both switches in one write and reports each', async () => {
    const { ctx, save } = setup({ result: { kind: 'save', settings: { use: false, generate: false } } });

    const output = await memories(ctx);

    expect(save).toHaveBeenCalledTimes(1);
    expect(output).toBe([
      'Use memories is now off. Saved to /data/autohand/config.json.',
      'Generate memories is now off. Saved to /data/autohand/config.json.',
    ].join('\n'));
  });

  it('opens with Use memories off after it was saved off', async () => {
    const { ctx, show } = setup({ config: { agent: { useMemories: false } } });

    await memories(ctx);

    expect(show.mock.calls[0][0].settings).toEqual({ use: false, generate: true });
  });

  it('shows the persisted value the next time it opens', async () => {
    const first = setup({ result: { kind: 'save', settings: { use: true, generate: false } } });
    await memories(first.ctx);
    const reopened = vi.fn(async (_overview: MemoriesOverview): Promise<MemoriesScreenResult> => ({ kind: 'cancel' }));

    await memories({ ...first.ctx, show: reopened });

    expect(reopened.mock.calls[0][0].settings).toEqual({ use: true, generate: false });
  });

  it('does not write the config when enter is pressed without a change', async () => {
    const { ctx, save } = setup({ result: { kind: 'save', settings: { use: true, generate: true } } });

    await expect(memories(ctx)).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('leaves the running config untouched and reports the failure when saving fails', async () => {
    const { ctx, config, save } = setup({ result: { kind: 'save', settings: { use: true, generate: false } } });
    save.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(memories(ctx)).resolves.toBe('Memory settings were not saved: EACCES: permission denied');
    expect(config.agent).toEqual({ maxIterations: 9 });
  });

  it('deletes every local store in the plan after a confirmed reset and reports each directory', async () => {
    const { ctx, memoryManager, save } = setup({ result: { kind: 'reset', settings: { use: true, generate: true } } });

    const output = await memories(ctx);

    expect(memoryManager.resetLocalStore.mock.calls).toEqual([['project'], ['user']]);
    expect(save).not.toHaveBeenCalled();
    expect(output).toBe([
      'Project memories: deleted 3 from /repo/.autohand/memory',
      'User memories: deleted 5 from /data/autohand/memory',
    ].join('\n'));
  });

  it('never deletes a user library that syncs with the account', async () => {
    const { ctx, memoryManager } = setup({
      config: { sync: { enabled: true } },
      result: { kind: 'reset', settings: { use: true, generate: true } },
    });

    const output = await memories(ctx);

    expect(memoryManager.resetLocalStore.mock.calls).toEqual([['project']]);
    expect(output).toContain('Project memories: deleted 3 from /repo/.autohand/memory');
    expect(output).not.toContain('User memories: deleted');
  });

  it('saves a pending toggle together with a confirmed reset', async () => {
    const { ctx, config, save } = setup({ result: { kind: 'reset', settings: { use: true, generate: false } } });

    const output = await memories(ctx);

    expect(save).toHaveBeenCalledTimes(1);
    expect(config.agent?.autoMemory).toBe(false);
    expect(output?.split('\n')[0]).toBe('Generate memories is now off. Saved to /data/autohand/config.json.');
    expect(output).toContain('User memories: deleted 5');
  });

  it('keeps going and names the directory when one store cannot be deleted', async () => {
    const { ctx, memoryManager } = setup({ result: { kind: 'reset', settings: { use: true, generate: true } } });
    memoryManager.resetLocalStore.mockImplementation(async (level) => {
      if (level === 'project') throw new Error('EBUSY: resource busy');
      return USER.entries;
    });

    const output = await memories(ctx);

    expect(output).toContain('Project memories: could not be deleted from /repo/.autohand/memory: EBUSY: resource busy');
    expect(output).toContain('User memories: deleted 5 from /data/autohand/memory');
  });

  it('reports the current state instead of opening a screen when there is no terminal', async () => {
    const { ctx, show } = setup({ interactive: false, config: { agent: { autoMemory: false } } });

    const output = await memories(ctx);

    expect(show).not.toHaveBeenCalled();
    expect(output).toContain('Memories');
    expect(output).toContain('Use memories: on (agent.useMemories in /data/autohand/config.json)');
    expect(output).toContain('Generate memories: off (agent.autoMemory in /data/autohand/config.json)');
    expect(output).not.toContain('not given to the model');

    const off = setup({ interactive: false, config: { agent: { useMemories: false } } });
    const offOutput = await memories(off.ctx);
    expect(offOutput).toContain('Use memories: off (agent.useMemories in /data/autohand/config.json)');
    expect(offOutput).toContain('Project memories: 3 saved in /repo/.autohand/memory');
    expect(offOutput).toContain('Stored memories are not given to the model (Use memories is off).');
    expect(output).toContain('Project memories: 3 saved in /repo/.autohand/memory');
    expect(output).toContain('User memories stay on this machine (sync is off).');
  });

  it('explains that the config is missing rather than failing', async () => {
    const { ctx, show } = setup();

    await expect(memories({ ...ctx, config: undefined })).resolves.toBe('Config not available.');
    expect(show).not.toHaveBeenCalled();
  });

  describe('dispatch', () => {
    it('pauses the main Ink frame around the screen and resumes it even when the screen fails', async () => {
      const order: string[] = [];
      const memoryManager = {
        describeLocalStores: vi.fn(async () => { order.push('screen'); throw new Error('disk gone'); }),
        hasSharedProjectMemory: () => false,
        recordCapabilityUse: vi.fn(),
      };
      const handler = new SlashCommandHandler({
        config: { configPath: '/data/autohand/config.json' },
        memoryManager,
        onBeforeModal: () => { order.push('before'); },
        onAfterModal: () => { order.push('after'); },
      } as never, SLASH_COMMANDS);

      const result = await handler.handle('/memories');

      expect(order).toEqual(['before', 'screen', 'after']);
      expect(result).toBe('Memories could not be opened: disk gone');
    });
  });
});
