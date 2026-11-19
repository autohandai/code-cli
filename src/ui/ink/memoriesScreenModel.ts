/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * State and rules behind the `/memories` screen, kept free of Ink so they can be tested directly.
 */
import { minimatch } from 'minimatch';
import type { LocalMemoryStore } from '../../memory/MemoryManager.js';
import { areMemoriesUsed } from '../../memory/memoryUse.js';
import type { LoadedConfig } from '../../types.js';

export interface MemoriesSettings {
  /** `agent.useMemories`: give stored memories to the model. */
  use: boolean;
  /** `agent.autoMemory`: save durable memories after completed interactive turns. */
  generate: boolean;
}

export type MemoriesSettingId = keyof MemoriesSettings;
export type MemoriesRowId = MemoriesSettingId | 'reset';

/** The config key behind each switch, as shown to the user. */
export const MEMORIES_SETTING_KEYS: Record<MemoriesSettingId, string> = {
  use: 'agent.useMemories',
  generate: 'agent.autoMemory',
};

const SETTING_IDS: readonly MemoriesSettingId[] = ['use', 'generate'];

export interface MemoriesRow {
  id: MemoriesRowId;
  kind: 'toggle' | 'action';
}

export const MEMORIES_ROWS: readonly MemoriesRow[] = [
  { id: 'use', kind: 'toggle' },
  { id: 'generate', kind: 'toggle' },
  { id: 'reset', kind: 'action' },
];

export function readMemoriesSettings(config: LoadedConfig): MemoriesSettings {
  return { use: areMemoriesUsed(config), generate: config.agent?.autoMemory !== false };
}

export function applyMemoriesSettings(config: LoadedConfig, settings: MemoriesSettings): void {
  config.agent = { ...config.agent, autoMemory: settings.generate, useMemories: settings.use };
}

/** The switches whose value differs, in screen order. */
export function memoriesSettingsChanged(before: MemoriesSettings, after: MemoriesSettings): MemoriesSettingId[] {
  return SETTING_IDS.filter((id) => before[id] !== after[id]);
}

const MEMORY_SYNC_PATHS = ['memory/', 'memory/events/LOG.jsonl'] as const;

/**
 * Whether the user library is uploaded by sync. A synced library also lives in the account, where
 * a local delete would either be undone by the next sync or have to be propagated.
 */
export function isUserMemorySynced(config: LoadedConfig): boolean {
  if (config.sync?.enabled !== true) return false;
  return !config.sync.exclude?.some((pattern) => MEMORY_SYNC_PATHS.some((file) => minimatch(file, pattern)));
}

export interface MemoryResetScope {
  userSynced: boolean;
  sharedProject: boolean;
}

export interface MemoryResetPlan {
  /** Local directories the reset clears. */
  deletes: LocalMemoryStore[];
  /** The user library syncs with the account and is left alone. */
  keepsSyncedUser: boolean;
  /** A team's shared project memories are active; they are never touched. */
  keepsSharedProject: boolean;
}

export function planMemoryReset(stores: readonly LocalMemoryStore[], scope: MemoryResetScope): MemoryResetPlan {
  return {
    deletes: stores.filter((store) => store.level !== 'user' || !scope.userSynced),
    keepsSyncedUser: scope.userSynced && stores.some((store) => store.level === 'user'),
    keepsSharedProject: scope.sharedProject,
  };
}

export interface MemoriesScreenState {
  step: 'options' | 'confirmReset';
  cursor: number;
  /** 0 keeps the memories, 1 deletes them. */
  confirmCursor: number;
  settings: MemoriesSettings;
}

export type MemoriesScreenEvent = 'up' | 'down' | 'toggle' | 'enter' | 'cancel';

export type MemoriesScreenResult =
  | { kind: 'cancel' }
  | { kind: 'save'; settings: MemoriesSettings }
  | { kind: 'reset'; settings: MemoriesSettings };

export interface MemoriesScreenTransition {
  state: MemoriesScreenState;
  /** Set when the screen is done. */
  result?: MemoriesScreenResult;
}

export function createMemoriesScreenState(settings: MemoriesSettings): MemoriesScreenState {
  return { step: 'options', cursor: 0, confirmCursor: 0, settings };
}

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

function reduceConfirmation(
  state: MemoriesScreenState,
  event: MemoriesScreenEvent,
  canReset: boolean,
): MemoriesScreenTransition {
  const back: MemoriesScreenTransition = { state: { ...state, step: 'options', confirmCursor: 0 } };
  switch (event) {
    case 'up':
    case 'down':
      return { state: { ...state, confirmCursor: clamp(state.confirmCursor + (event === 'down' ? 1 : -1), canReset ? 1 : 0) } };
    case 'enter':
      return canReset && state.confirmCursor === 1
        ? { state, result: { kind: 'reset', settings: state.settings } }
        : back;
    case 'cancel':
      return back;
    default:
      return { state };
  }
}

export function reduceMemoriesScreen(
  state: MemoriesScreenState,
  event: MemoriesScreenEvent,
  options: { canReset?: boolean } = {},
): MemoriesScreenTransition {
  if (state.step === 'confirmReset') {
    return reduceConfirmation(state, event, options.canReset !== false);
  }

  const row = MEMORIES_ROWS[state.cursor];
  switch (event) {
    case 'up':
    case 'down':
      return { state: { ...state, cursor: clamp(state.cursor + (event === 'down' ? 1 : -1), MEMORIES_ROWS.length - 1) } };
    case 'toggle':
      return row && row.id !== 'reset'
        ? { state: { ...state, settings: { ...state.settings, [row.id]: !state.settings[row.id] } } }
        : { state };
    case 'enter':
      return row?.kind === 'action'
        ? { state: { ...state, step: 'confirmReset', confirmCursor: 0 } }
        : { state, result: { kind: 'save', settings: state.settings } };
    case 'cancel':
      return { state, result: { kind: 'cancel' } };
    default:
      return { state };
  }
}
