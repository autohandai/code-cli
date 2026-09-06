/**
 * Account-scoped Coding Agent control plane.
 *
 * Connector credentials only travel between the signed-in CLI and the API over
 * TLS. They are never included in Console reads or settings snapshots.
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import { z } from 'zod';

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

const secretValues = z.record(z.string().min(1).max(120), z.string().max(8192));
const connectorBase = {
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
};
const managedConnectorSchema = z.discriminatedUnion('transport', [
  z.object({ ...connectorBase, transport: z.literal('http'), url: z.string().url().refine(isSecureEndpoint), headers: secretValues.optional() }),
  z.object({ ...connectorBase, transport: z.literal('stdio'), command: z.string().trim().min(1).max(512), args: z.array(z.string().max(2048)).max(64).optional(), env: secretValues.optional() }),
]);
export type ManagedConnector = z.infer<typeof managedConnectorSchema>;

function isSecureEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' || (
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ));
  } catch { return false; }
}

function validateConnectorSnapshot(revision: number, connectors: unknown): ManagedConnector[] {
  const parsed = z.array(managedConnectorSchema).safeParse(connectors);
  if (!Number.isSafeInteger(revision) || revision < 0 || !parsed.success ||
    new Set(parsed.data.map(({ id }) => id)).size !== parsed.data.length ||
    parsed.data.some((connector) => connector.revision > revision)) {
    throw new Error('Coding Agent connector sync response was invalid');
  }
  return parsed.data;
}

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
  private readonly accountId: string | undefined;

  constructor(config: LoadedConfig) {
    const configured = config.api?.baseUrl?.trim() || process.env.AUTOHAND_API_URL?.trim();
    const baseUrl = (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    if (!isSecureEndpoint(baseUrl)) throw new Error('Invalid Coding Agent API base URL');
    this.baseUrl = baseUrl;
    this.accountId = config.api?.accountId?.trim() || process.env.AUTOHAND_ACCOUNT_ID?.trim() || undefined;
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
    const revision = payload.revision;
    if (!payload.success || !Array.isArray(payload.connectors) || !Number.isInteger(revision)) {
      throw new Error(payload.error || 'Coding Agent connector sync response was invalid');
    }
    if (typeof revision !== 'number') throw new Error('Coding Agent connector sync response was invalid');
    return { revision, connectors: validateConnectorSnapshot(revision, payload.connectors) };
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
    if (init.signal?.aborted) controller.abort(init.signal.reason);
    try {
      const response = await fetch(`${this.baseUrl}${route}`, {
        ...init,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          ...(this.accountId ? { 'X-Autohand-Account-Id': this.accountId } : {}),
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
  const rest = Object.fromEntries(
    Object.entries(config).filter(([key]) => !['auth', 'mcp', 'configPath', 'isNewConfig'].includes(key)),
  );
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

function connectorTarget(config: McpServerConfigEntry | ManagedConnector): string {
  const sorted = (values: Record<string, string> = {}) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(config.transport === 'http'
    ? [config.transport, config.url, sorted(config.headers)]
    : [config.transport, config.command, config.args || [], sorted(config.env)]);
}

export function applyManagedConnectors(
  config: LoadedConfig,
  revision: number,
  connectors: ManagedConnector[],
): { changed: boolean; servers: McpServerConfigEntry[] } {
  const validated = validateConnectorSnapshot(revision, connectors);
  const currentServers = config.mcp?.servers || [];
  const unmanaged = currentServers.filter((server) => !server.managedConnectorId && !validated.some((connector) =>
    connector.name === server.name && connectorTarget(connector) === connectorTarget(server),
  ));
  const names = new Set(unmanaged.map(({ name }) => name));
  const managed = validated.map<McpServerConfigEntry>((connector) => {
    const stem = connector.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/__+/g, '_').replace(/^-+|-+$/g, '').slice(0,32) || 'connector';
    let name = stem;
    let suffix = 1;
    while (names.has(name)) name = `${stem}-${suffix++}`;
    names.add(name);
    return {
      name,
      transport: connector.transport,
      ...(connector.transport === 'http'
        ? { url: connector.url, headers: connector.headers || {} }
        : { command: connector.command, args: connector.args || [], env: connector.env || {} }),
      autoConnect: connector.enabled,
      managedConnectorId: connector.id,
      managedConnectorRevision: revision,
    };
  });
  const servers = [...unmanaged, ...managed];
  const changed = JSON.stringify(currentServers) !== JSON.stringify(servers);
  if (changed) config.mcp = { ...config.mcp, servers };
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
  options: {
    signal?: AbortSignal;
    publishLocalConnectors?: boolean;
    onMcpApplied?: (mcp: LoadedConfig['mcp']) => Promise<void> | void;
  } = {},
): Promise<CodingAgentControlPlaneSyncResult> {
  const deviceId = await getOrCreateCodingAgentDeviceId();
  const client = new CodingAgentControlPlaneClient(config);
  const [initialState, settingsProfiles] = await Promise.all([
    client.pullConnectors(authToken, deviceId, options.signal),
    client.pullSettingsProfiles(authToken, options.signal).catch(() => [] as CodingAgentSettingsProfile[]),
  ]);
  let changed = false;
  const apply = async (state: typeof initialState) => {
    options.signal?.throwIfAborted();
    const candidate = structuredClone(config);
    const defaultProfile = settingsProfiles.find((profile) => profile.isDefault);
    const profileApplied = defaultProfile ? applyCodingAgentSettingsProfile(candidate, defaultProfile) : { changed: false };
    const applied = applyManagedConnectors(candidate, state.revision, state.connectors);
    if (applied.changed || profileApplied.changed) {
      await saveConfig(candidate);
      options.signal?.throwIfAborted();
      Object.assign(config, candidate);
      changed = true;
    }
    await options.onMcpApplied?.(config.mcp);
  };
  await apply(initialState);
  let revision = initialState.revision;
  if (options.publishLocalConnectors) {
    let published = false;
    for (const server of config.mcp?.servers || []) {
      if (server.managedConnectorId || (server.transport !== 'http' && server.transport !== 'stdio')) continue;
      if (initialState.connectors.some(({ name }) => name.toLowerCase() === server.name.toLowerCase())) continue;
      await client.createConnector(authToken, server, options.signal);
      published = true;
    }
    if (published) {
      const state = await client.pullConnectors(authToken, deviceId, options.signal);
      await apply(state);
      revision = state.revision;
    }
  }
  await client.acknowledgeConnectors(authToken, deviceId, revision, options.signal);
  await client.uploadSettingsSnapshot(authToken, createCodingAgentSettingsSnapshot(config, deviceId), options.signal);
  return { changed, mcp: config.mcp, revision };
}
