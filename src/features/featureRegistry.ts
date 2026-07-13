/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../types.js';
import type { RemoteFeatureFlagSnapshot } from './RemoteFeatureFlagManager.js';

export type FeatureStage = 'stable' | 'experimental' | 'deprecated';
export type FeatureSource = 'local' | 'remote';

export interface FeatureDefinition {
  id: string;
  label: string;
  description: string;
  stage: FeatureStage;
  configPath?: string;
  defaultEnabled: boolean;
  requiresRestart?: boolean;
  source?: FeatureSource;
}

export interface FeatureState extends FeatureDefinition {
  enabled: boolean;
  source: FeatureSource;
  remoteEnabled?: boolean;
  reason?: string;
  userOverridable?: boolean;
  localOverride?: 'off';
  lastEvaluatedAt?: string;
}

export interface FeatureMutationResult {
  ok: boolean;
  feature?: FeatureState;
  error?: string;
}

export interface FeatureRegistryOptions {
  remoteSnapshot?: RemoteFeatureFlagSnapshot | null;
}

export const AWS_BEDROCK_PROVIDER_FLAG = 'aws_bedrock_provider';

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  {
    id: 'mcp',
    label: 'MCP tools',
    description: 'Connect configured Model Context Protocol servers and expose their tools.',
    stage: 'stable',
    configPath: 'mcp.enabled',
    defaultEnabled: true,
    requiresRestart: true,
  },
  {
    id: 'hooks',
    label: 'Lifecycle hooks',
    description: 'Run configured shell hooks around prompts, tools, sessions, and notifications.',
    stage: 'stable',
    configPath: 'hooks.enabled',
    defaultEnabled: true,
  },
  {
    id: 'teams',
    label: 'Agent teams',
    description: 'Enable multi-agent team coordination commands and teammate execution.',
    stage: 'experimental',
    configPath: 'teams.enabled',
    defaultEnabled: true,
  },
  {
    id: 'community_skills',
    label: 'Community skills',
    description: 'Enable discovery and use of community skill packs.',
    stage: 'stable',
    configPath: 'communitySkills.enabled',
    defaultEnabled: true,
  },
  {
    id: 'prompt_suggestions',
    label: 'Prompt suggestions',
    description: 'Show generated next-step suggestions in the interactive prompt placeholder.',
    stage: 'stable',
    configPath: 'ui.promptSuggestions',
    defaultEnabled: true,
  },
  {
    id: 'request_queue',
    label: 'Request queue',
    description: 'Allow typing follow-up requests while the agent is still working.',
    stage: 'stable',
    configPath: 'agent.enableRequestQueue',
    defaultEnabled: true,
  },
  {
    id: 'thinking_display',
    label: 'Thinking display',
    description: 'Show model thinking or reasoning blocks when the provider returns them.',
    stage: 'stable',
    configPath: 'ui.showThinking',
    defaultEnabled: true,
  },
  {
    id: 'completion_notifications',
    label: 'Completion notifications',
    description: 'Show desktop notifications when an agent turn completes.',
    stage: 'stable',
    configPath: 'ui.showCompletionNotification',
    defaultEnabled: true,
  },
  {
    id: 'terminal_bell',
    label: 'Terminal bell',
    description: 'Ring the terminal bell when work completes.',
    stage: 'stable',
    configPath: 'ui.terminalBell',
    defaultEnabled: true,
  },
  {
    id: 'tool_selection_cache',
    label: 'Tool selection cache',
    description: 'Cache local tool-schema selection for equivalent turns.',
    stage: 'stable',
    configPath: 'agent.toolSelectionCache',
    defaultEnabled: true,
  },
  {
    id: 'usage_v2',
    label: 'Usage v2',
    description: 'Show the v2 usage dashboard with model, provider, context, and limit details.',
    stage: 'experimental',
    configPath: 'features.usageV2',
    defaultEnabled: false,
  },
  {
    id: 'cli_usage_v2',
    label: 'CLI usage v2',
    description: 'Show the token activity dashboard for /usage daily, weekly, and monthly.',
    stage: 'experimental',
    configPath: 'features.cliUsageV2',
    defaultEnabled: true,
  },
  {
    id: AWS_BEDROCK_PROVIDER_FLAG,
    label: 'AWS Bedrock provider',
    description: 'Enable AWS Bedrock as a first-class model provider.',
    stage: 'experimental',
    configPath: 'features.awsBedrockProvider',
    defaultEnabled: true,
    requiresRestart: true,
  },
  {
    id: 'slash_goal',
    label: 'Slash goal',
    description: 'Enable experimental persistent goals across /goal, --goal, tools, RPC, and ACP.',
    stage: 'experimental',
    configPath: 'features.slashGoal',
    defaultEnabled: false,
  },
  {
    id: 'token_usage_status',
    label: 'Token usage status',
    description: 'Show real-time token usage (tokens up/down and context window occupancy) in the status line.',
    stage: 'experimental',
    configPath: 'features.tokenUsageStatus',
    defaultEnabled: false,
  },
  {
    id: 'experimental_fork',
    label: 'Experimental fork',
    description: 'Enable branching a new session from the active session or an earlier user message.',
    stage: 'experimental',
    configPath: 'features.experimentalFork',
    defaultEnabled: false,
  },
  {
    id: 'experimental_clone',
    label: 'Experimental clone',
    description: 'Enable duplicating the active session branch into a new session.',
    stage: 'experimental',
    configPath: 'features.experimentalClone',
    defaultEnabled: false,
  },
  {
    id: 'experimental_handoff',
    label: 'Experimental handoff',
    description: 'Enable handoff session commands for continuing work from another Autohand surface.',
    stage: 'experimental',
    configPath: 'features.experimentalHandoff',
    defaultEnabled: false,
  },
  {
    id: 'chrome_integration',
    label: 'Chrome integration',
    description: 'Start the browser bridge by default for Chrome extension handoff.',
    stage: 'experimental',
    configPath: 'chrome.enabledByDefault',
    defaultEnabled: false,
    requiresRestart: true,
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    description: 'Share anonymized product telemetry when explicitly enabled.',
    stage: 'stable',
    configPath: 'telemetry.enabled',
    defaultEnabled: false,
  },
] as const;

export function isAwsBedrockProviderEnabled(config?: Pick<LoadedConfig, 'features'> | null): boolean {
  const definition = FEATURE_REGISTRY.find((feature) => feature.id === AWS_BEDROCK_PROVIDER_FLAG);
  return config?.features?.awsBedrockProvider ?? definition?.defaultEnabled ?? true;
}

export function isTokenUsageStatusEnabled(config?: Pick<LoadedConfig, 'features'> | null): boolean {
  const definition = FEATURE_REGISTRY.find((feature) => feature.id === 'token_usage_status');
  return config?.features?.tokenUsageStatus ?? definition?.defaultEnabled ?? false;
}

const LOCAL_FEATURE_IDS = new Set(FEATURE_REGISTRY.map((feature) => feature.id));

export function isLocalFeatureId(id: string): boolean {
  return LOCAL_FEATURE_IDS.has(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getNestedValue(root: LoadedConfig, configPath: string): unknown {
  let current: unknown = root;
  for (const part of configPath.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setNestedValue(root: LoadedConfig, configPath: string, value: boolean): void {
  const parts = configPath.split('.');
  let current = root as unknown as Record<string, unknown>;

  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!isRecord(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function getRemoteFeatureStates(config: LoadedConfig, options: FeatureRegistryOptions = {}): FeatureState[] {
  const remoteOverrides = config.features?.remoteOverrides || {};
  const snapshot = options.remoteSnapshot;
  if (!snapshot) return [];

  return snapshot.flags.filter((flag) => !isLocalFeatureId(flag.key) && isVisibleRemoteExperiment(flag)).map((flag) => {
    const localOverride = remoteOverrides[flag.key] === 'off' ? 'off' : undefined;
    return {
      id: flag.key,
      label: flag.key,
      description: `Remote feature flag (${flag.reason})`,
      stage: 'experimental',
      defaultEnabled: false,
      enabled: flag.enabled && localOverride !== 'off',
      source: 'remote',
      remoteEnabled: flag.enabled,
      reason: flag.reason,
      userOverridable: flag.userOverridable,
      localOverride,
      lastEvaluatedAt: snapshot.evaluatedAt,
    };
  });
}

export function isVisibleRemoteExperiment(flag: RemoteFeatureFlagSnapshot['flags'][number]): boolean {
  const reason = flag.reason.toLowerCase();
  if (reason.includes('archived') || reason.includes('client_type mismatch') || reason.includes('client type mismatch')) {
    return false;
  }

  return !flag.clientTypes || flag.clientTypes.length === 0 || flag.clientTypes.includes('cli');
}

export function findFeature(id: string, options: FeatureRegistryOptions = {}): FeatureDefinition | undefined {
  const local = FEATURE_REGISTRY.find((feature) => feature.id === id);
  if (local) return local;

  const remote = options.remoteSnapshot?.flags.find((flag) => flag.key === id && isVisibleRemoteExperiment(flag));
  if (!remote) return undefined;

  return {
    id: remote.key,
    label: remote.key,
    description: `Remote feature flag (${remote.reason})`,
    stage: 'experimental',
    defaultEnabled: false,
    source: 'remote',
  };
}

export function getFeatureState(config: LoadedConfig, id: string, options: FeatureRegistryOptions = {}): FeatureState | undefined {
  const definition = FEATURE_REGISTRY.find((feature) => feature.id === id);
  if (definition) {
    const rawValue = definition.configPath ? getNestedValue(config, definition.configPath) : undefined;
    return {
      ...definition,
      source: 'local',
      enabled: typeof rawValue === 'boolean' ? rawValue : definition.defaultEnabled,
    };
  }

  return getRemoteFeatureStates(config, options).find((feature) => feature.id === id);
}

export function listFeatureStates(config: LoadedConfig, options: FeatureRegistryOptions = {}): FeatureState[] {
  const local = FEATURE_REGISTRY.map((feature) => ({
    ...feature,
    source: 'local' as const,
    enabled: getFeatureState(config, feature.id, options)?.enabled ?? feature.defaultEnabled,
  }));
  return [...local, ...getRemoteFeatureStates(config, options)];
}

export function setFeatureState(
  config: LoadedConfig,
  id: string,
  enabled: boolean,
  options: FeatureRegistryOptions = {}
): FeatureMutationResult {
  const definition = FEATURE_REGISTRY.find((feature) => feature.id === id);
  if (definition) {
    if (!definition.configPath) {
      return { ok: false, error: `Feature "${id}" cannot be changed locally.` };
    }

    setNestedValue(config, definition.configPath, enabled);
    return {
      ok: true,
      feature: getFeatureState(config, id, options),
    };
  }

  const remoteFeature = getRemoteFeatureStates(config, options).find((feature) => feature.id === id);
  if (!remoteFeature) {
    return { ok: false, error: `Unknown feature "${id}".` };
  }

  config.features ||= {};
  config.features.remoteOverrides ||= {};

  if (enabled) {
    delete config.features.remoteOverrides[id];
    return { ok: true, feature: getFeatureState(config, id, options) };
  }

  if (!remoteFeature.userOverridable) {
    return { ok: false, error: `Feature "${id}" is controlled remotely and cannot be changed locally.` };
  }

  config.features.remoteOverrides[id] = 'off';
  return { ok: true, feature: getFeatureState(config, id, options) };
}

export function formatFeatureList(config: LoadedConfig, options: FeatureRegistryOptions = {}): string {
  const states = listFeatureStates(config, options);
  const idWidth = Math.max(...states.map((feature) => feature.id.length), 'feature'.length);
  const sourceWidth = Math.max(...states.map((feature) => feature.source.length), 'source'.length);
  const stageWidth = Math.max(...states.map((feature) => feature.stage.length), 'stage'.length);

  return states
    .map((feature) => (
      `${feature.id.padEnd(idWidth + 2)}${feature.source.padEnd(sourceWidth + 2)}${feature.stage.padEnd(stageWidth + 2)}${String(feature.enabled)}`
    ))
    .join('\n');
}

export function formatFeatureStatus(config: LoadedConfig, id: string, options: FeatureRegistryOptions = {}): string {
  const feature = getFeatureState(config, id, options);
  if (!feature) {
    return `Unknown feature "${id}".`;
  }

  const restart = feature.requiresRestart ? 'yes' : 'no';
  const lines = [
    `${feature.id}`,
    `Label: ${feature.label}`,
    `Source: ${feature.source}`,
    `Stage: ${feature.stage}`,
    `Enabled: ${String(feature.enabled)}`,
    `Config: ${feature.configPath || 'remote'}`,
    `Default: ${String(feature.defaultEnabled)}`,
    `Restart required: ${restart}`,
    `Description: ${feature.description}`,
  ];

  if (feature.source === 'remote') {
    lines.push(
      `Remote enabled: ${String(feature.remoteEnabled)}`,
      `Local override: ${feature.localOverride || 'none'}`,
      `Reason: ${feature.reason || 'unknown'}`,
      `User overridable: ${String(feature.userOverridable !== false)}`,
      `Last evaluated: ${feature.lastEvaluatedAt || 'never'}`
    );
  }

  return lines.join('\n');
}
