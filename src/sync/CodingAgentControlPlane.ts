/**
 * Account-scoped Coding Agent control plane.
 *
 * Connector credentials only travel between the signed-in CLI and the API over
 * TLS. They are never included in Console reads or settings snapshots.
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';

import { AUTOHAND_FILES, AUTOHAND_HOME } from '../constants.js';
import {
  getNestedValue,
  setNestedValue,
  SETTING_CATEGORIES,
  SETTINGS_REGISTRY,
  type SettingDef,
} from '../commands/settings.js';
import { saveConfig } from '../config.js';
import { t } from '../i18n/index.js';
import type { LoadedConfig, McpServerConfigEntry } from '../types.js';

const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const CONTROL_PLANE_TIMEOUT_MS = 30_000;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|credential|auth|cookie)/i;

export type ManagedConnectorTransport = 'http' | 'stdio';

export type ManagedConnector = {
  id: string;
  name: string;
  transport: ManagedConnectorTransport;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  revision: number;
};

export type CodingAgentSettingsSnapshot = {
  deviceId: string;
  schemaVersion: number;
  settings: Array<{
    key: string;
    label: string;
    description?: string;
    category: string;
    type: 'boolean' | 'string' | 'number' | 'enum';
    value: string | number | boolean | null | string[];
  }>;
  config: Record<string, unknown>;
};

export type CodingAgentSettingsProfile = {
  id: string;
  name: string;
  settings: Record<string, string | number | boolean>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConnectorStateResponse = {
  success?: boolean;
  revision?: number;
  connectors?: ManagedConnector[];
  error?: string;
};

type ConnectorMutationResponse = {
  success?: boolean;
  connector?: { id?: string };
  error?: string;
};

type ControlPlaneResponse = {
  success?: boolean;
  error?: string;
};

type SettingsProfilesResponse = {
  success?: boolean;
  profiles?: CodingAgentSettingsProfile[];
  error?: string;
};

export class CodingAgentControlPlaneClient {
  private readonly baseUrl: string;

  constructor(config: LoadedConfig) {
    const configured = config.api?.baseUrl?.trim() || process.env.AUTOHAND_API_URL?.trim();
    this.baseUrl = (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  }

  async pullConnectors(authToken: string, deviceId: string, signal?: AbortSignal): Promise<{
    revision: number;
    connectors: ManagedConnector[];
  }> {
    const payload = await this.request<ConnectorStateResponse>(
      '/v1/coding-agent/cli/connectors',
      authToken,
      {
        headers: { 'X-Autohand-CLI-Device-Id': deviceId },
        method: 'GET',
        signal,
      },
    );
    const revision = Number(payload.revision);
    if (!payload.success || !Array.isArray(payload.connectors) || !Number.isInteger(revision)) {
      throw new Error(payload.error || 'Coding Agent connector sync response was invalid');
    }
    return { revision, connectors: payload.connectors };
  }

  async acknowledgeConnectors(
    authToken: string,
    deviceId: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const payload = await this.request<ControlPlaneResponse>(
      '/v1/coding-agent/cli/connectors/ack',
      authToken,
      {
        body: JSON.stringify({ deviceId, revision }),
        method: 'PUT',
        signal,
      },
    );
    if (!payload.success) throw new Error(payload.error || 'Coding Agent connector acknowledgement failed');
  }

  async createConnector(
    authToken: string,
    server: McpServerConfigEntry,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (server.transport !== 'http' && server.transport !== 'stdio') return null;
    const payload = await this.request<ConnectorMutationResponse>(
      '/v1/coding-agent/connectors',
      authToken,
      {
        body: JSON.stringify({
          name: server.name,
          transport: server.transport,
          ...(server.transport === 'http'
            ? { url: server.url, headers: server.headers }
            : { command: server.command, args: server.args || [], env: server.env }),
          enabled: server.autoConnect !== false,
        }),
        method: 'POST',
        signal,
      },
    );
    if (!payload.success) throw new Error(payload.error || `Could not publish connector "${server.name}"`);
    return payload.connector?.id || null;
  }

  async uploadSettingsSnapshot(
    authToken: string,
    snapshot: CodingAgentSettingsSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    const payload = await this.request<ControlPlaneResponse>(
      '/v1/coding-agent/settings-snapshot',
      authToken,
      {
        body: JSON.stringify(snapshot),
        method: 'PUT',
        signal,
      },
    );
    if (!payload.success) throw new Error(payload.error || 'Coding Agent settings snapshot upload failed');
  }

  async pullSettingsProfiles(
    authToken: string,
    signal?: AbortSignal,
  ): Promise<CodingAgentSettingsProfile[]> {
    const payload = await this.request<SettingsProfilesResponse>(
      '/v1/coding-agent/cli/settings-profiles',
      authToken,
      { method: 'GET', signal },
    );
    if (!payload.success || !Array.isArray(payload.profiles)) {
      throw new Error(payload.error || 'Coding Agent settings profile sync response was invalid');
    }
    return payload.profiles;
  }

  private async request<T>(
    route: string,
    authToken: string,
    init: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTROL_PLANE_TIMEOUT_MS);
    timer.unref?.();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${route}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as T & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Coding Agent control plane request failed (${response.status})`);
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted && !init.signal?.aborted) {
        throw new Error('Coding Agent control plane request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  }
}

export type CodingAgentControlPlaneSyncResult = {
  changed: boolean
  mcp: LoadedConfig['mcp']
  revision: number
}

export async function getOrCreateCodingAgentDeviceId(): Promise<string> {
  try {
    await fs.ensureDir(AUTOHAND_HOME);
    if (await fs.pathExists(AUTOHAND_FILES.deviceId)) {
      const existing = (await fs.readFile(AUTOHAND_FILES.deviceId, 'utf8')).trim();
      if (existing) return existing;
    }
    const deviceId = crypto.randomUUID();
    await fs.writeFile(AUTOHAND_FILES.deviceId, deviceId, 'utf8');
    return deviceId;
  } catch {
    return crypto.randomUUID();
  }
}

function redactConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfigValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, nestedValue]) => [key, redactConfigValue(nestedValue)]),
  );
}

export function createCodingAgentSettingsSnapshot(config: LoadedConfig, deviceId: string): CodingAgentSettingsSnapshot {
  const categoryLabels = new Map(
    SETTING_CATEGORIES.map((category) => [category.id, t(category.labelKey)]),
  );
  const settings = SETTINGS_REGISTRY.flatMap((definition) => {
    if (definition.type === 'password') return [];
    const value = getNestedValue(config as unknown as Record<string, unknown>, definition.key);
    if (value === undefined || Array.isArray(value) && !value.every((item) => typeof item === 'string')) {
      return [];
    }
    if (
      value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'boolean'
      && !Array.isArray(value)
    ) {
      return [];
    }
    return [{
      key: definition.key,
      label: t(definition.labelKey),
      ...(definition.descriptionKey ? { description: t(definition.descriptionKey) } : {}),
      category: categoryLabels.get(definition.category) || definition.category,
      type: definition.type,
      value,
    }];
  });
  const { auth: _auth, mcp: _mcp, configPath: _configPath, isNewConfig: _isNewConfig, ...rest } = config;
  return {
    deviceId,
    schemaVersion: 1,
    settings,
    config: redactConfigValue(rest) as Record<string, unknown>,
  };
}

function acceptsProfileValue(setting: SettingDef, value: unknown): value is string | number | boolean {
  if (setting.type === 'password') return false;
  if (setting.type === 'boolean') return typeof value === 'boolean';
  if (setting.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (setting.type === 'enum') return typeof value === 'string' && Boolean(setting.enumValues?.includes(value));
  return typeof value === 'string';
}

/**
 * Applies a server-selected profile only through the same public registry that
 * backs `/settings` and `autohand config set`. Unknown and credential-bearing
 * keys cannot reach a local config file through this path.
 */
export function applyCodingAgentSettingsProfile(
  config: LoadedConfig,
  profile: CodingAgentSettingsProfile,
): { changed: boolean; appliedKeys: string[] } {
  const settingsByKey = new Map(SETTINGS_REGISTRY.map((setting) => [setting.key, setting]));
  const appliedKeys: string[] = [];
  for (const [key, value] of Object.entries(profile.settings)) {
    const setting = settingsByKey.get(key);
    if (!setting || !acceptsProfileValue(setting, value)) continue;
    if (Object.is(getNestedValue(config as unknown as Record<string, unknown>, key), value)) continue;
    setNestedValue(config as unknown as Record<string, unknown>, key, value);
    appliedKeys.push(key);
  }
  return { changed: appliedKeys.length > 0, appliedKeys };
}

export async function applyDefaultCodingAgentSettingsProfileOnLogin(
  config: LoadedConfig,
  authToken: string,
): Promise<CodingAgentSettingsProfile | null> {
  const profiles = await new CodingAgentControlPlaneClient(config).pullSettingsProfiles(authToken);
  const profile = profiles.find((candidate) => candidate.isDefault);
  if (!profile) return null;
  const applied = applyCodingAgentSettingsProfile(config, profile);
  if (applied.changed) await saveConfig(config);
  return profile;
}

export function applyManagedConnectors(
  config: LoadedConfig,
  revision: number,
  connectors: ManagedConnector[],
): { changed: boolean; servers: McpServerConfigEntry[] } {
  const currentServers = config.mcp?.servers || [];
  const unmanaged = currentServers.filter((server) => !server.managedConnectorId);
  const managed = connectors.map<McpServerConfigEntry>((connector) => ({
    name: connector.name,
    transport: connector.transport,
    ...(connector.transport === 'http'
      ? { url: connector.url || '', headers: connector.headers || {} }
      : { command: connector.command || '', args: connector.args || [], env: connector.env || {} }),
    autoConnect: connector.enabled,
    managedConnectorId: connector.id,
    managedConnectorRevision: revision,
  }));
  const servers = [...unmanaged, ...managed];
  const changed = JSON.stringify(currentServers) !== JSON.stringify(servers);
  if (changed) {
    config.mcp = { ...config.mcp, servers };
  }
  return { changed, servers };
}

/**
 * Reconcile user-level MCP configuration with the account control plane.
 * This is shared by the background service and one-shot CLI management
 * commands so a `autohand mcp connect` change reaches Console even when the
 * interactive runtime is not already running.
 */
export async function syncCodingAgentControlPlane(
  config: LoadedConfig,
  authToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<CodingAgentControlPlaneSyncResult> {
  const deviceId = await getOrCreateCodingAgentDeviceId();
  const client = new CodingAgentControlPlaneClient(config);
  // Settings profiles are an additive control-plane feature. Do not make an
  // existing connector sync unavailable while a client is talking to an older
  // API deployment or lacks access to profiles.
  const settingsProfilesPromise = client
    .pullSettingsProfiles(authToken, options.signal)
    .catch(() => [] as CodingAgentSettingsProfile[]);
  for (const server of config.mcp?.servers || []) {
    if (server.managedConnectorId || (server.transport !== 'http' && server.transport !== 'stdio')) {
      continue;
    }
    try {
      await client.createConnector(authToken, server, options.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists')) throw error;
    }
  }
  const [state, settingsProfiles] = await Promise.all([
    client.pullConnectors(authToken, deviceId, options.signal),
    settingsProfilesPromise,
  ]);
  const defaultProfile = settingsProfiles.find((profile) => profile.isDefault);
  const profileApplied = defaultProfile
    ? applyCodingAgentSettingsProfile(config, defaultProfile)
    : { changed: false, appliedKeys: [] };
  const applied = applyManagedConnectors(config, state.revision, state.connectors);
  if (applied.changed || profileApplied.changed) await saveConfig(config);
  await client.uploadSettingsSnapshot(
    authToken,
    createCodingAgentSettingsSnapshot(config, deviceId),
    options.signal,
  );
  await client.acknowledgeConnectors(authToken, deviceId, state.revision, options.signal);
  return { changed: applied.changed || profileApplied.changed, mcp: config.mcp, revision: state.revision };
}
