/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from '../i18n/index.js';
import readline from 'node:readline';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { loadConfig, saveConfig } from '../config.js';
import type { SyncService } from '../sync/SyncService.js';
import {
  getSyncService as getRuntimeSyncService,
  setSyncService as setRuntimeSyncService,
} from '../sync/runtimeSyncService.js';
import { createCommandTheme } from './commandTheme.js';

export const metadata = {
  command: '/sync',
  description: t('commands.sync.description'),
  implemented: true,
};

type TabName = 'Status' | 'Settings' | 'Activity';

interface SyncData {
  enabled: boolean;
  isRunning: boolean;
  lastSync: string | null;
  fileCount: number;
  totalSize: number;
  interval: number;
  syncService: SyncService | null;
  isLoggedIn: boolean;
  includeTelemetry: boolean;
  includeFeedback: boolean;
}

export function setSyncService(service: SyncService | null): void {
  setRuntimeSyncService(service);
}

export function getSyncService(): SyncService | null {
  return getRuntimeSyncService();
}

export async function sync(ctx: SlashCommandContext): Promise<string | null> {
  const config = await loadConfig();
  const isLoggedIn = Boolean(config.auth?.token && config.auth?.user);

  if (!isLoggedIn) {
    const theme = createCommandTheme();
    console.log(theme.warning('\nSettings sync requires authentication.'));
    console.log(theme.muted('Run /login to sign in and enable cloud sync.\n'));
    return null;
  }

  // Gather sync data
  const data = await gatherSyncData(ctx, config);

  // Render interactive UI
  await renderSyncUI(data, ctx);

  return null;
}

async function gatherSyncData(ctx: SlashCommandContext, config: any): Promise<SyncData> {
  const syncService = getRuntimeSyncService();
  let status = {
    enabled: false,
    syncing: false,
    lastSync: null as string | null,
    fileCount: 0,
    totalSize: 0,
  };

  if (syncService) {
    try {
      status = await syncService.getStatus();
    } catch {
      // Ignore errors
    }
  }

  return {
    enabled: config.sync?.enabled !== false,
    isRunning: syncService?.isRunning ?? false,
    lastSync: status.lastSync,
    fileCount: status.fileCount,
    totalSize: status.totalSize,
    interval: config.sync?.interval ?? 300000,
    syncService,
    isLoggedIn: Boolean(config.auth?.token),
    includeTelemetry: config.sync?.includeTelemetry ?? false,
    includeFeedback: config.sync?.includeFeedback ?? false,
  };
}

function renderSyncUI(data: SyncData, ctx: SlashCommandContext): Promise<void> {
  return new Promise((resolve) => {
    const tabs: TabName[] = ['Status', 'Settings', 'Activity'];
    let currentTab = 0;
    // const _needsRefresh = false;

    const input = process.stdin as NodeJS.ReadStream;
    const isTTY = input.isTTY;

    const wasRaw = (input as any).isRaw;
    const wasPaused = typeof input.isPaused === 'function' ? input.isPaused() : false;

    if (wasPaused && typeof input.resume === 'function') {
      input.resume();
    }

    if (isTTY) {
      readline.emitKeypressEvents(input);
      if (!wasRaw && typeof input.setRawMode === 'function') {
        try { input.setRawMode(true); } catch { /* TTY may be gone */ }
      }
      if (typeof input.setEncoding === 'function') {
        input.setEncoding('utf8');
      }
    }

    const render = () => {
      const theme = createCommandTheme();
      process.stdout.write('\x1B[2J\x1B[H');

      renderTabHeader(tabs, currentTab);
      renderTabContent(tabs[currentTab], data);
      console.log(theme.muted('\nEsc to exit | Tab to cycle | s: sync now | e: toggle enabled'));
    };

    const handler = async (_str: string, key: readline.Key) => {
      const char = (_str || '').toLowerCase();

      if (key.name === 'escape' || (key.name === 'c' && key.ctrl)) {
        cleanup();
        resolve();
        return;
      }

      if (key.name === 'tab' && key.shift) {
        currentTab = (currentTab - 1 + tabs.length) % tabs.length;
        render();
        return;
      }

      if (key.name === 'tab' || key.name === 'right') {
        currentTab = (currentTab + 1) % tabs.length;
        render();
        return;
      }

      if (key.name === 'left') {
        currentTab = (currentTab - 1 + tabs.length) % tabs.length;
        render();
        return;
      }

      if (char === 's') {
        // Trigger manual sync
        if (data.syncService) {
          const theme = createCommandTheme();
          console.log(theme.accent('\nSyncing...'));
          try {
            const result = await data.syncService.sync();
            if (result.success) {
              console.log(theme.success(`Sync complete! Uploaded: ${result.uploaded}, Downloaded: ${result.downloaded}`));
            } else {
              console.log(theme.error(`Sync failed: ${result.error}`));
            }
            // Refresh data
            const config = await loadConfig();
            Object.assign(data, await gatherSyncData(ctx, config));
          } catch (err) {
            console.log(theme.error(`Sync error: ${err}`));
          }
          await sleep(1500);
          render();
        }
        return;
      }

      if (char === 'e') {
        // Toggle sync enabled
        try {
          const config = await loadConfig();
          const newEnabled = config.sync?.enabled === false;
          config.sync = { ...config.sync, enabled: newEnabled };
          await saveConfig(config);
          data.enabled = newEnabled;
          console.log(createCommandTheme().accent(`\n${newEnabled ? t('commands.sync.enabled') : t('commands.sync.disabled')}`));
          await sleep(1000);
          render();
        } catch (err) {
          console.log(createCommandTheme().error(`Error toggling sync: ${err}`));
        }
        return;
      }
    };

    const cleanup = () => {
      input.off('keypress', handler as any);
      if (isTTY && !wasRaw && typeof input.setRawMode === 'function') {
        try { input.setRawMode(false); } catch { /* TTY may be gone */ }
      }
      if (wasPaused && typeof input.pause === 'function') {
        input.pause();
      }
      process.stdout.write('\x1B[2J\x1B[H');
    };

    input.on('keypress', handler as any);
    render();
  });
}

function renderTabHeader(tabs: TabName[], currentIndex: number): void {
  const theme = createCommandTheme();
  const header = tabs
    .map((tab, i) => {
      return i === currentIndex ? theme.selectedTab(tab) : theme.tab(tab);
    })
    .join('  ');

  console.log(`Settings Sync: ${header}  ${theme.muted('(tab to cycle)')}\n`);
}

function renderTabContent(tab: TabName, data: SyncData): void {
  switch (tab) {
    case 'Status':
      renderStatusTab(data);
      break;
    case 'Settings':
      renderSettingsTab(data);
      break;
    case 'Activity':
      renderActivityTab(data);
      break;
  }
}

function renderStatusTab(data: SyncData): void {
  const theme = createCommandTheme();
  console.log(theme.bold('Sync Status\n'));

  const statusIcon = data.enabled ? theme.success('\u2713') : theme.error('\u2717');
  const runningIcon = data.isRunning ? theme.success('\u2713') : theme.warning('\u25CB');

  console.log(`  ${theme.accent('Enabled'.padEnd(20))} ${statusIcon} ${data.enabled ? 'Yes' : 'No'}`);
  console.log(`  ${theme.accent('Service Running'.padEnd(20))} ${runningIcon} ${data.isRunning ? 'Yes' : 'No'}`);
  console.log(`  ${theme.accent('Last Sync'.padEnd(20))} ${data.lastSync ? formatDate(data.lastSync) : theme.muted('Never')}`);
  console.log(`  ${theme.accent('Files Tracked'.padEnd(20))} ${data.fileCount}`);
  console.log(`  ${theme.accent('Total Size'.padEnd(20))} ${formatSize(data.totalSize)}`);
  console.log(`  ${theme.accent('Sync Interval'.padEnd(20))} ${formatInterval(data.interval)}`);
}

function renderSettingsTab(data: SyncData): void {
  const theme = createCommandTheme();
  console.log(theme.bold('Sync Settings\n'));

  console.log(`  ${theme.accent('Enabled'.padEnd(25))} ${data.enabled ? theme.success('true') : theme.muted('false')}`);
  console.log(`  ${theme.accent('Interval'.padEnd(25))} ${formatInterval(data.interval)}`);
  console.log(`  ${theme.accent('Include Telemetry'.padEnd(25))} ${data.includeTelemetry ? theme.success('true') : theme.muted('false')}`);
  console.log(`  ${theme.accent('Include Feedback'.padEnd(25))} ${data.includeFeedback ? theme.success('true') : theme.muted('false')}`);

  console.log(theme.bold('\nWhat Gets Synced\n'));
  console.log(theme.muted('  \u2713 config.json (API keys encrypted)'));
  console.log(theme.muted('  \u2713 agents/ (custom agents)'));
  console.log(theme.muted('  \u2713 skills/ (custom skills)'));
  console.log(theme.muted('  \u2713 hooks/ (user hooks)'));
  console.log(theme.muted('  \u2713 memory/ (user memory)'));
  console.log(theme.muted('  \u2713 sessions/ (session history)'));
  console.log(theme.muted('  \u2713 projects/ (project knowledge)'));

  console.log(theme.bold('\nNot Synced\n'));
  console.log(theme.muted('  \u2717 device-id (unique per device)'));
  console.log(theme.muted('  \u2717 error.log (local only)'));
  console.log(theme.muted('  \u2717 version-*.json (cache files)'));
}

function renderActivityTab(data: SyncData): void {
  const theme = createCommandTheme();
  console.log(theme.bold('Recent Sync Activity\n'));

  if (!data.lastSync) {
    console.log(theme.muted('  No sync activity yet.'));
    console.log(theme.muted('  Press "s" to trigger a manual sync.'));
    return;
  }

  console.log(`  ${theme.accent('Last successful sync:')} ${formatDate(data.lastSync)}`);
  console.log(`  ${theme.accent('Files synced:')} ${data.fileCount}`);
  console.log(`  ${theme.accent('Data transferred:')} ${formatSize(data.totalSize)}`);

  console.log(theme.bold('\nTips\n'));
  console.log(theme.muted('  - Sync runs automatically every 5 minutes'));
  console.log(theme.muted('  - Press "s" anytime to trigger a manual sync'));
  console.log(theme.muted('  - Cloud data takes priority on conflicts'));
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
  } catch {
    return isoString;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatInterval(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours > 1 ? 's' : ''}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
