/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { saveConfig } from '../config.js';
import type { LoadedConfig } from '../types.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import {
  formatFeatureList,
  formatFeatureStatus,
  getFeatureState,
  listFeatureStates,
  setFeatureState,
} from '../features/featureRegistry.js';
import { loadRemoteFeatureFlags, type RemoteFeatureFlagSnapshot } from '../features/RemoteFeatureFlagManager.js';

export interface FeaturesCommandContext {
  config?: LoadedConfig;
  interactive?: boolean;
}

function renderUsage(): string {
  return [
    'Usage: /experiments [list|status|enable|disable|refresh]',
    '',
    'Commands:',
    '  /experiments',
    '  /experiments list',
    '  /experiments status <feature>',
    '  /experiments enable <feature>',
    '  /experiments disable <feature>',
    '  /experiments refresh',
  ].join('\n');
}

function requireConfig(config?: LoadedConfig): LoadedConfig | string {
  return config ?? 'Config not available.';
}

export async function setFeatureEnabled(
  config: LoadedConfig,
  featureId: string | undefined,
  enabled: boolean,
  remoteSnapshot?: RemoteFeatureFlagSnapshot | null
): Promise<string> {
  if (!featureId) {
    return renderUsage();
  }

  const snapshot = remoteSnapshot === undefined ? await loadRemoteFeatureFlags(config) : remoteSnapshot;
  const result = setFeatureState(config, featureId, enabled, { remoteSnapshot: snapshot });
  if (!result.ok || !result.feature) {
    return result.error ?? `Unknown feature "${featureId}".`;
  }

  await saveConfig(config);
  if (result.feature.source === 'remote') {
    if (enabled) {
      return `Following remote state for ${result.feature.id} (currently ${result.feature.enabled ? 'on' : 'off'}).`;
    }
    return `Disabled ${result.feature.id} locally. Remote state remains ${result.feature.remoteEnabled ? 'on' : 'off'}.`;
  }

  const action = enabled ? 'Enabled' : 'Disabled';
  const restartNote = result.feature.requiresRestart ? ' Restart Autohand for this to fully apply.' : '';
  return `${action} ${result.feature.id}.${restartNote}`;
}

async function showInteractiveFeatures(
  config: LoadedConfig,
  remoteSnapshot?: RemoteFeatureFlagSnapshot | null
): Promise<string | null> {
  let toggleCount = 0;
  const pendingSaves: Promise<void>[] = [];
  const states = listFeatureStates(config, { remoteSnapshot });
  const initialStates = new Map(states.map((feature) => [feature.id, feature.enabled]));
  const finalStates = new Map(initialStates);
  const restartRequired = new Set(states.filter((feature) => feature.requiresRestart).map((feature) => feature.id));
  const options: ModalOption[] = states.map((feature) => ({
    label: `${feature.id.padEnd(26)} ${feature.source.padEnd(8)} ${feature.stage.padEnd(12)} ${feature.enabled ? 'on' : 'off'}`,
    value: feature.id,
    checked: feature.enabled,
    description: feature.description,
  }));

  await showModal({
    title: 'Experiments - space toggles, enter closes',
    options,
    multiSelect: true,
    maxVisible: 12,
    onToggle: (option, checked) => {
      const result = setFeatureState(config, option.value, checked, { remoteSnapshot });
      if (!result.ok) {
        return;
      }
      toggleCount += 1;
      finalStates.set(option.value, result.feature?.enabled ?? checked);
      pendingSaves.push(saveConfig(config));
    },
  });

  await Promise.all(pendingSaves);

  if (toggleCount === 0) {
    return null;
  }

  const enabled: string[] = [];
  const disabled: string[] = [];
  for (const [featureId, initiallyEnabled] of initialStates) {
    const finallyEnabled = finalStates.get(featureId);
    if (finallyEnabled === initiallyEnabled || typeof finallyEnabled !== 'boolean') {
      continue;
    }
    if (finallyEnabled) {
      enabled.push(featureId);
    } else {
      disabled.push(featureId);
    }
  }

  return formatInteractiveFeatureSummary({
    enabled,
    disabled,
    restartRequired: [...new Set([...enabled, ...disabled].filter((featureId) => restartRequired.has(featureId)))],
  });
}

function formatChangedFeatures(action: 'Enabled' | 'Disabled', featureIds: string[]): string | null {
  if (featureIds.length === 0) {
    return null;
  }

  if (featureIds.length === 1) {
    return `${action} ${featureIds[0]}.`;
  }

  return `${action} ${featureIds.length} features: ${featureIds.join(', ')}.`;
}

function formatInteractiveFeatureSummary(changes: {
  enabled: string[];
  disabled: string[];
  restartRequired: string[];
}): string | null {
  const parts = [
    formatChangedFeatures('Enabled', changes.enabled),
    formatChangedFeatures('Disabled', changes.disabled),
  ].filter((part): part is string => Boolean(part));

  if (changes.restartRequired.length > 0) {
    parts.push(`Restart required for: ${changes.restartRequired.join(', ')}.`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

export async function features(ctx: FeaturesCommandContext, args: string[] = []): Promise<string | null> {
  const required = requireConfig(ctx.config);
  if (typeof required === 'string') {
    return required;
  }

  const subcommand = (args[0] ?? '').toLowerCase();
  const featureId = args[1];
  const forceRefresh = subcommand === 'refresh';
  const remoteSnapshot = await loadRemoteFeatureFlags(required, {
    forceRefresh,
    allowCachedFallback: !forceRefresh,
  });

  switch (subcommand) {
    case '':
      return showInteractiveFeatures(required, remoteSnapshot);
    case 'list':
    case 'ls':
      if (ctx.interactive) {
        return showInteractiveFeatures(required, remoteSnapshot);
      }
      return formatFeatureList(required, { remoteSnapshot });
    case 'status':
    case 'show':
      return featureId ? formatFeatureStatus(required, featureId, { remoteSnapshot }) : renderUsage();
    case 'enable':
    case 'on':
      return setFeatureEnabled(required, featureId, true, remoteSnapshot);
    case 'disable':
    case 'off':
      return setFeatureEnabled(required, featureId, false, remoteSnapshot);
    case 'refresh':
      if (!remoteSnapshot) {
        return 'No remote feature flags available. Using local feature switches only.';
      }
      return `Downloaded ${remoteSnapshot.flags.length} remote feature${remoteSnapshot.flags.length === 1 ? '' : 's'} from ${remoteSnapshot.environment}.`;
    default:
      if (getFeatureState(required, subcommand, { remoteSnapshot })) {
        return formatFeatureStatus(required, subcommand, { remoteSnapshot });
      }
      return renderUsage();
  }
}

export const metadata = {
  command: '/experiments',
  description: 'list and toggle Autohand experiments',
  implemented: true,
  subcommands: [
    { name: 'list', description: 'List experiments and current state' },
    { name: 'status', description: 'Show one experiment' },
    { name: 'enable', description: 'Enable an experiment' },
    { name: 'disable', description: 'Disable an experiment' },
    { name: 'refresh', description: 'Download remote feature flags from the Autohand API' },
  ],
};
