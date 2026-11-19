/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { saveConfig } from '../config.js';
import { t } from '../i18n/index.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { LoadedConfig } from '../types.js';
import {
  displayMemoryPath,
  memoriesSettingLabel,
  memoryStoreLabel,
  showMemoriesScreen,
  type MemoriesOverview,
} from '../ui/ink/components/MemoriesScreen.js';
import {
  MEMORIES_SETTING_KEYS,
  applyMemoriesSettings,
  isUserMemorySynced,
  memoriesSettingsChanged,
  planMemoryReset,
  readMemoriesSettings,
  type MemoriesScreenResult,
  type MemoriesSettingId,
  type MemoriesSettings,
  type MemoryResetPlan,
} from '../ui/ink/memoriesScreenModel.js';

export interface MemoriesCommandContext {
  config?: LoadedConfig;
  memoryManager: Pick<MemoryManager, 'describeLocalStores' | 'resetLocalStore' | 'hasSharedProjectMemory'>;
  /** Whether a terminal is attached; defaults to stdout being a TTY. */
  interactive?: boolean;
  show?: (overview: MemoriesOverview) => Promise<MemoriesScreenResult>;
  save?: (config: LoadedConfig) => Promise<void>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const onOff = (value: boolean): string => t(value ? 'commands.memories.on' : 'commands.memories.off');

async function buildOverview(ctx: MemoriesCommandContext, config: LoadedConfig): Promise<MemoriesOverview> {
  const stores = await ctx.memoryManager.describeLocalStores();
  const userSynced = isUserMemorySynced(config);
  return {
    settings: readMemoriesSettings(config),
    configPath: config.configPath,
    stores,
    userSynced,
    resetPlan: planMemoryReset(stores, { userSynced, sharedProject: ctx.memoryManager.hasSharedProjectMemory() }),
  };
}

function formatStatus(overview: MemoriesOverview): string {
  return [
    chalk.bold.cyan(t('commands.memories.title')),
    ...(Object.keys(MEMORIES_SETTING_KEYS) as MemoriesSettingId[]).map((id) => t('commands.memories.statusSetting', {
      label: memoriesSettingLabel(id),
      state: onOff(overview.settings[id]),
      key: MEMORIES_SETTING_KEYS[id],
      path: displayMemoryPath(overview.configPath),
    })),
    ...overview.stores.map((store) => t('commands.memories.storeLine', {
      label: memoryStoreLabel(store),
      count: store.entries,
      directory: displayMemoryPath(store.directory),
    })),
    t(overview.userSynced ? 'commands.memories.syncedUser' : 'commands.memories.localUser'),
    ...(overview.resetPlan.keepsSharedProject ? [t('commands.memories.sharedProject')] : []),
    ...(overview.settings.use ? [] : [t('commands.memories.notUsed')]),
  ].join('\n');
}

/** Persists first and only then touches the running config, so a failed write changes nothing. */
async function saveSettings(
  ctx: MemoriesCommandContext,
  config: LoadedConfig,
  settings: MemoriesSettings,
): Promise<string | null> {
  const changed = memoriesSettingsChanged(readMemoriesSettings(config), settings);
  if (changed.length === 0) return null;

  const updated = structuredClone(config);
  applyMemoriesSettings(updated, settings);
  try {
    await (ctx.save ?? saveConfig)(updated);
  } catch (error) {
    return chalk.red(t('commands.memories.saveFailed', { error: errorMessage(error) }));
  }
  applyMemoriesSettings(config, settings);
  return changed.map((id) => chalk.green(t('commands.memories.saved', {
    label: memoriesSettingLabel(id),
    state: onOff(settings[id]),
    path: displayMemoryPath(config.configPath),
  }))).join('\n');
}

async function resetLocalMemories(ctx: MemoriesCommandContext, plan: MemoryResetPlan): Promise<string[]> {
  if (plan.deletes.length === 0) return [t('commands.memories.resetNothing')];

  const lines: string[] = [];
  for (const store of plan.deletes) {
    const label = memoryStoreLabel(store);
    const directory = displayMemoryPath(store.directory);
    try {
      const count = await ctx.memoryManager.resetLocalStore(store.level);
      lines.push(chalk.green(t('commands.memories.resetDone', { label, count, directory })));
    } catch (error) {
      lines.push(chalk.red(t('commands.memories.resetFailed', { label, directory, error: errorMessage(error) })));
    }
  }
  return lines;
}

/**
 * Memories command - a settings screen for memory generation and a local reset.
 *
 * The outcome is returned rather than printed so it lands in the transcript once the screen closes.
 */
export async function memories(ctx: MemoriesCommandContext): Promise<string | null> {
  const { config } = ctx;
  if (!config) return chalk.yellow(t('commands.memories.unavailable'));

  try {
    const overview = await buildOverview(ctx, config);
    if (!(ctx.interactive ?? process.stdout.isTTY)) return formatStatus(overview);

    const result = await (ctx.show ?? showMemoriesScreen)(overview);
    if (result.kind === 'cancel') return null;

    const saved = await saveSettings(ctx, config, result.settings);
    if (result.kind === 'save') return saved;

    return [...(saved ? [saved] : []), ...await resetLocalMemories(ctx, overview.resetPlan)].join('\n');
  } catch (error) {
    return chalk.red(t('commands.memories.openFailed', { error: errorMessage(error) }));
  }
}

export const metadata = {
  command: '/memories',
  description: t('commands.memories.description'),
  implemented: true,
};
