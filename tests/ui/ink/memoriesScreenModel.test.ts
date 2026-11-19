/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  MEMORIES_ROWS,
  applyMemoriesSettings,
  createMemoriesScreenState,
  isUserMemorySynced,
  memoriesSettingsChanged,
  planMemoryReset,
  readMemoriesSettings,
  reduceMemoriesScreen,
  type MemoriesScreenState,
} from '../../../src/ui/ink/memoriesScreenModel.js';
import type { LocalMemoryStore } from '../../../src/memory/MemoryManager.js';
import type { LoadedConfig } from '../../../src/types.js';

const config = (overrides: Partial<LoadedConfig> = {}): LoadedConfig =>
  ({ configPath: '/home/me/.autohand/config.json', ...overrides }) as LoadedConfig;

const stores: LocalMemoryStore[] = [
  { level: 'project', directory: '/repo/.autohand/memory', entries: 3 },
  { level: 'user', directory: '/home/me/.autohand/memory', entries: 5 },
];

describe('memories settings', () => {
  it('reads both switches from the agent block, on unless explicitly disabled', () => {
    expect(readMemoriesSettings(config())).toEqual({ use: true, generate: true });
    expect(readMemoriesSettings(config({ agent: {} }))).toEqual({ use: true, generate: true });
    expect(readMemoriesSettings(config({ agent: { autoMemory: false } }))).toEqual({ use: true, generate: false });
    expect(readMemoriesSettings(config({ agent: { useMemories: false } }))).toEqual({ use: false, generate: true });
    expect(readMemoriesSettings(config({ agent: { useMemories: false, autoMemory: false } }))).toEqual({ use: false, generate: false });
  });

  it('writes both settings back without disturbing the rest of the agent block', () => {
    const target = config({ agent: { maxIterations: 7, autoMemory: true } });

    applyMemoriesSettings(target, { use: false, generate: false });

    expect(target.agent).toEqual({ maxIterations: 7, autoMemory: false, useMemories: false });
    expect(readMemoriesSettings(target)).toEqual({ use: false, generate: false });
  });

  it('keeps the two switches independent: use off with generate on', () => {
    const target = config();

    applyMemoriesSettings(target, { use: false, generate: true });

    expect(target.agent).toEqual({ autoMemory: true, useMemories: false });
  });

  it('reports a change when either value differs', () => {
    const saved = { use: true, generate: true };
    expect(memoriesSettingsChanged(saved, { use: true, generate: true })).toEqual([]);
    expect(memoriesSettingsChanged(saved, { use: false, generate: true })).toEqual(['use']);
    expect(memoriesSettingsChanged(saved, { use: true, generate: false })).toEqual(['generate']);
    expect(memoriesSettingsChanged(saved, { use: false, generate: false })).toEqual(['use', 'generate']);
  });

  it('exposes Use above Generate, then the reset action', () => {
    expect(MEMORIES_ROWS).toEqual([
      { id: 'use', kind: 'toggle' },
      { id: 'generate', kind: 'toggle' },
      { id: 'reset', kind: 'action' },
    ]);
  });
});

describe('whether user memories sync with the account', () => {
  it('is off unless sync was explicitly enabled', () => {
    expect(isUserMemorySynced(config())).toBe(false);
    expect(isUserMemorySynced(config({ sync: {} }))).toBe(false);
    expect(isUserMemorySynced(config({ sync: { enabled: false } }))).toBe(false);
    expect(isUserMemorySynced(config({ sync: { enabled: true } }))).toBe(true);
  });

  it.each([['memory/'], ['memory/**'], ['memory/events/LOG.jsonl'], ['**/LOG.jsonl']])(
    'is off when sync excludes memory with %s',
    (pattern) => {
      expect(isUserMemorySynced(config({ sync: { enabled: true, exclude: [pattern] } }))).toBe(false);
    },
  );

  it('stays on when sync excludes something unrelated', () => {
    expect(isUserMemorySynced(config({ sync: { enabled: true, exclude: ['sessions/**'] } }))).toBe(true);
  });
});

describe('planning a reset', () => {
  it('deletes both local stores when nothing is synced or shared', () => {
    expect(planMemoryReset(stores, { userSynced: false, sharedProject: false })).toEqual({
      deletes: stores,
      keepsSyncedUser: false,
      keepsSharedProject: false,
    });
  });

  it('keeps the user library when it syncs with the account', () => {
    expect(planMemoryReset(stores, { userSynced: true, sharedProject: false })).toEqual({
      deletes: [stores[0]],
      keepsSyncedUser: true,
      keepsSharedProject: false,
    });
  });

  it('still clears the local project directory when the project is shared, and says the team copy stays', () => {
    expect(planMemoryReset(stores, { userSynced: false, sharedProject: true })).toEqual({
      deletes: stores,
      keepsSyncedUser: false,
      keepsSharedProject: true,
    });
  });

  it('has nothing to delete outside a workspace with a synced user library', () => {
    expect(planMemoryReset([stores[1]], { userSynced: true, sharedProject: false }).deletes).toEqual([]);
  });
});

describe('screen state', () => {
  const start = (settings = { use: true, generate: true }): MemoriesScreenState => createMemoriesScreenState(settings);
  const press = (state: MemoriesScreenState, ...events: Array<Parameters<typeof reduceMemoriesScreen>[1]>): MemoriesScreenState =>
    events.reduce((current, event) => reduceMemoriesScreen(current, event).state, state);
  const onReset = (state = start()): MemoriesScreenState => press(state, 'down', 'down');

  it('starts on the first option with the saved values', () => {
    expect(start({ use: false, generate: false })).toEqual({
      step: 'options', cursor: 0, confirmCursor: 0, settings: { use: false, generate: false },
    });
  });

  it('moves between rows and stops at both ends', () => {
    expect(press(start(), 'down').cursor).toBe(1);
    expect(press(start(), 'down', 'down', 'down').cursor).toBe(2);
    expect(press(start(), 'down', 'up', 'up').cursor).toBe(0);
  });

  it('toggles only the checkbox under the cursor and leaves the action row alone', () => {
    const use = reduceMemoriesScreen(start(), 'toggle');
    expect(use.state.settings).toEqual({ use: false, generate: true });
    expect(use.result).toBeUndefined();

    expect(press(start(), 'down', 'toggle').settings).toEqual({ use: true, generate: false });
    expect(press(onReset(), 'toggle')).toEqual(onReset());
  });

  it('saves both pending values together on enter over either checkbox', () => {
    const pending = press(start(), 'toggle', 'down', 'toggle');

    expect(reduceMemoriesScreen(pending, 'enter').result).toEqual({ kind: 'save', settings: { use: false, generate: false } });
    expect(reduceMemoriesScreen(press(pending, 'up'), 'enter').result).toEqual({ kind: 'save', settings: { use: false, generate: false } });
  });

  it('cancels from the options without a save', () => {
    expect(reduceMemoriesScreen(press(start(), 'toggle'), 'cancel').result).toEqual({ kind: 'cancel' });
  });

  it('opens the reset confirmation on the safe choice and does nothing yet', () => {
    const opened = reduceMemoriesScreen(onReset(), 'enter');

    expect(opened.result).toBeUndefined();
    expect(opened.state.step).toBe('confirmReset');
    expect(opened.state.confirmCursor).toBe(0);
  });

  it('returns to the options when the reset is refused, by choice or by escape', () => {
    const confirming = press(onReset(), 'enter');

    for (const event of ['enter', 'cancel'] as const) {
      const refused = reduceMemoriesScreen(confirming, event);
      expect(refused.result).toBeUndefined();
      expect(refused.state.step).toBe('options');
      expect(refused.state.cursor).toBe(2);
    }
  });

  it('resets only after moving to the destructive choice and confirming, carrying pending values', () => {
    let state = press(onReset(press(start(), 'toggle')), 'enter');
    expect(reduceMemoriesScreen(state, 'toggle')).toEqual({ state });
    state = press(state, 'down');
    expect(state.confirmCursor).toBe(1);

    expect(reduceMemoriesScreen(state, 'enter').result).toEqual({ kind: 'reset', settings: { use: false, generate: true } });
  });

  it('only offers going back when there is nothing to delete', () => {
    let state = reduceMemoriesScreen(onReset(), 'enter', { canReset: false }).state;
    state = reduceMemoriesScreen(state, 'down', { canReset: false }).state;
    expect(state.confirmCursor).toBe(0);

    const back = reduceMemoriesScreen(state, 'enter', { canReset: false });
    expect(back.result).toBeUndefined();
    expect(back.state.step).toBe('options');
  });
});
