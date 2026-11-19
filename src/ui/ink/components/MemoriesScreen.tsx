/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The `/memories` screen: one checkbox for memory generation, one destructive action with its own
 * confirmation step, and a read-only summary of where memories live.
 */
import os from 'node:os';
import path from 'node:path';
import React, { useState } from 'react';
import { Box, Text, render, useInput, useStdout } from 'ink';

import { t } from '../../../i18n/index.js';
import type { LocalMemoryStore } from '../../../memory/MemoryManager.js';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { I18nProvider } from '../../i18n/index.js';
import {
  MEMORIES_ROWS,
  createMemoriesScreenState,
  reduceMemoriesScreen,
  type MemoriesRow,
  type MemoriesScreenEvent,
  type MemoriesScreenResult,
  type MemoriesSettingId,
  type MemoriesSettings,
  type MemoryResetPlan,
} from '../memoriesScreenModel.js';
import { cleanupModalRender, isModalCancelInput, prepareModalRender, resumeModalInput } from './Modal.js';

/** Below this width a description no longer fits beside its label and moves underneath. */
const SIDE_BY_SIDE_MIN_COLUMNS = 72;
const FALLBACK_COLUMNS = 80;
const SELECTED_MARKER = '›';

export interface MemoriesOverview {
  settings: MemoriesSettings;
  configPath: string;
  stores: LocalMemoryStore[];
  userSynced: boolean;
  resetPlan: MemoryResetPlan;
}

export interface MemoriesScreenProps {
  overview: MemoriesOverview;
  onDone: (result: MemoriesScreenResult) => void;
  /** Overrides the terminal width in tests. */
  columns?: number;
}

export function displayMemoryPath(target: string): string {
  const home = os.homedir();
  return target === home || target.startsWith(`${home}${path.sep}`) ? `~${target.slice(home.length)}` : target;
}

export function memoryStoreLabel(store: LocalMemoryStore): string {
  return t(store.level === 'project' ? 'commands.memories.storeProject' : 'commands.memories.storeUser');
}

export function memoriesSettingLabel(id: MemoriesSettingId): string {
  return t(`commands.memories.${id}`);
}

function rowLabel(row: MemoriesRow, settings: MemoriesSettings): string {
  if (row.id === 'reset') return `    ${t('commands.memories.reset')}`;
  return `[${settings[row.id] ? 'x' : ' '}] ${memoriesSettingLabel(row.id)}`;
}

function rowDescription(row: MemoriesRow): string {
  return t(`commands.memories.${row.id}Desc`);
}

function toEvent(input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]): MemoriesScreenEvent | null {
  if (isModalCancelInput(input, key)) return 'cancel';
  if (key.upArrow || input === 'k') return 'up';
  if (key.downArrow || input === 'j') return 'down';
  if (key.return) return 'enter';
  if (input === ' ') return 'toggle';
  return null;
}

export function MemoriesScreen({ overview, onDone, columns }: MemoriesScreenProps) {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const [state, setState] = useState(() => createMemoriesScreenState(overview.settings));
  const width = columns ?? stdout?.columns ?? FALLBACK_COLUMNS;
  const sideBySide = width >= SIDE_BY_SIDE_MIN_COLUMNS;
  const canReset = overview.resetPlan.deletes.length > 0;

  useInput((input, key) => {
    const event = toEvent(input, key);
    if (!event) return;
    const transition = reduceMemoriesScreen(state, event, { canReset });
    setState(transition.state);
    if (transition.result) onDone(transition.result);
  });

  const selectable = (label: string, selected: boolean): string => {
    const line = `${selected ? SELECTED_MARKER : ' '} ${label}`;
    return selected ? theme.selected(line) : theme.fg('text', line);
  };
  const muted = (text: string): string => theme.fg('muted', text);

  if (state.step === 'confirmReset') {
    const { resetPlan } = overview;
    const choices = canReset
      ? [t('commands.memories.confirmKeep'), t('commands.memories.confirmDelete')]
      : [t('commands.memories.confirmBack')];
    const kept = [
      ...(resetPlan.keepsSyncedUser
        ? overview.stores.filter((store) => store.level === 'user').map((store) =>
            t('commands.memories.keepsSynced', { directory: displayMemoryPath(store.directory) }))
        : []),
      ...(resetPlan.keepsSharedProject ? [t('commands.memories.keepsShared')] : []),
      t('commands.memories.keepsSessions'),
      t('commands.memories.keepsAccount'),
    ];

    return (
      <Box flexDirection="column" paddingX={1} width={width}>
        <Text>{theme.fg('warning', t('commands.memories.confirmTitle'))}</Text>
        <Text> </Text>
        {canReset ? (
          <>
            <Text>{t('commands.memories.confirmDeletes')}</Text>
            {resetPlan.deletes.map((store) => (
              <Box key={store.level} flexDirection="column" paddingLeft={2}>
                <Text wrap="wrap">
                  {`- ${t('commands.memories.confirmStore', { label: memoryStoreLabel(store), count: store.entries })}`}
                </Text>
                <Box paddingLeft={2}><Text wrap="wrap">{muted(displayMemoryPath(store.directory))}</Text></Box>
              </Box>
            ))}
          </>
        ) : (
          <Text wrap="wrap">{t('commands.memories.confirmNothing')}</Text>
        )}
        <Text> </Text>
        <Text>{t('commands.memories.confirmKeeps')}</Text>
        {kept.map((line) => (
          <Box key={line} paddingLeft={2}>
            <Text wrap="wrap">{muted(`- ${line}`)}</Text>
          </Box>
        ))}
        <Text> </Text>
        {choices.map((choice, index) => (
          <Text key={choice}>{selectable(choice, index === state.confirmCursor)}</Text>
        ))}
        <Text> </Text>
        <Text>{muted(t('commands.memories.confirmHint'))}</Text>
      </Box>
    );
  }

  const labels = MEMORIES_ROWS.map((row) => rowLabel(row, state.settings));
  const labelWidth = Math.max(...labels.map((label) => label.length));

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      <Text>{theme.fg('accent', t('commands.memories.title'))}</Text>
      <Text wrap="wrap">
        {muted(t('commands.memories.intro', { path: displayMemoryPath(overview.configPath) }))}
      </Text>
      <Text> </Text>
      {MEMORIES_ROWS.map((row, index) => {
        const label = selectable(labels[index].padEnd(labelWidth), index === state.cursor);
        const description = muted(rowDescription(row));
        return sideBySide ? (
          <Box key={row.id}>
            <Box flexShrink={0}><Text>{label}</Text></Box>
            <Box paddingLeft={2}><Text wrap="wrap">{description}</Text></Box>
          </Box>
        ) : (
          <Box key={row.id} flexDirection="column">
            <Text>{label}</Text>
            <Box paddingLeft={6}><Text wrap="wrap">{description}</Text></Box>
          </Box>
        );
      })}
      <Text> </Text>
      {overview.stores.map((store) => (
        <Text key={store.level} wrap="wrap">
          {muted(t('commands.memories.storeLine', {
            label: memoryStoreLabel(store),
            count: store.entries,
            directory: displayMemoryPath(store.directory),
          }))}
        </Text>
      ))}
      <Text wrap="wrap">
        {muted(t(overview.userSynced ? 'commands.memories.syncedUser' : 'commands.memories.localUser'))}
      </Text>
      {overview.resetPlan.keepsSharedProject && (
        <Text wrap="wrap">{muted(t('commands.memories.sharedProject'))}</Text>
      )}
      {!overview.settings.use && (
        <Text wrap="wrap">{theme.fg('warning', t('commands.memories.notUsed'))}</Text>
      )}
      <Text wrap="wrap">{muted(t('commands.memories.viewHint'))}</Text>
      <Text> </Text>
      <Text>{muted(t('commands.memories.hint'))}</Text>
    </Box>
  );
}

/**
 * Renders the screen on the alternate buffer and resolves with the user's decision.
 * Callers must wrap this in the slash context's onBeforeModal/onAfterModal so the main Ink app
 * releases stdin first.
 */
export async function showMemoriesScreen(
  overview: MemoriesOverview,
  output: NodeJS.WriteStream = process.stdout,
): Promise<MemoriesScreenResult> {
  prepareModalRender(output);
  resumeModalInput(process.stdin);
  // Let a just-unmounted Ink instance finish releasing stdin before this one claims it.
  await new Promise<void>((resolve) => setImmediate(resolve));

  try {
    return await new Promise<MemoriesScreenResult>((resolve) => {
      let result: MemoriesScreenResult = { kind: 'cancel' };
      let settled = false;
      const instance = render(
        <I18nProvider>
          <ThemeProvider>
            <MemoriesScreen
              overview={overview}
              onDone={(next) => {
                if (settled) return;
                settled = true;
                result = next;
                instance.unmount();
              }}
            />
          </ThemeProvider>
        </I18nProvider>,
        { exitOnCtrlC: false },
      );

      void instance.waitUntilExit().then(() => resolve(result));
    });
  } finally {
    cleanupModalRender(output);
  }
}
