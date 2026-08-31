import { describe, expect, it } from 'vitest';

import {
  applyCodingAgentSettingsProfile,
  applyManagedConnectors,
  createCodingAgentSettingsSnapshot,
} from '../../src/sync/CodingAgentControlPlane.js';
import type { LoadedConfig } from '../../src/types.js';

describe('Coding Agent control plane', () => {
  it('keeps credentials and authentication data out of the Console settings snapshot', () => {
    const config = {
      configPath: '/tmp/autohand/config.json',
      auth: { token: 'session-secret' },
      ui: { theme: 'dark' },
      openrouter: { apiKey: 'provider-secret', model: 'autohand-code' },
      search: { braveApiKey: 'search-secret' },
      mcp: {
        servers: [{
          name: 'private-mcp',
          transport: 'http',
          url: 'https://mcp.example.com',
          headers: { Authorization: 'Bearer secret' },
        }],
      },
    } as LoadedConfig;

    const snapshot = createCodingAgentSettingsSnapshot(config, 'device-1');
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'ui.theme', value: 'dark' }),
    ]));
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('search-secret');
    expect(serialized).not.toContain('Bearer secret');
    expect(snapshot.config).not.toHaveProperty('auth');
    expect(snapshot.config).not.toHaveProperty('mcp');
    expect(snapshot.config.openrouter).toEqual({ model: 'autohand-code' });
  });

  it('replaces only previously managed connectors and preserves local project-independent entries', () => {
    const config = {
      configPath: '/tmp/autohand/config.json',
      mcp: {
        servers: [
          {
            name: 'local-only',
            transport: 'stdio',
            command: 'npx',
            args: ['local-tool'],
          },
          {
            name: 'old-remote',
            transport: 'http',
            url: 'https://old.example.com',
            managedConnectorId: 'connector-old',
            managedConnectorRevision: 4,
          },
        ],
      },
    } as LoadedConfig;

    const applied = applyManagedConnectors(config, 5, [{
      id: 'connector-new',
      name: 'workspace-api',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer protected' },
      enabled: true,
      revision: 5,
    }]);

    expect(applied.changed).toBe(true);
    expect(applied.servers).toEqual([
      expect.objectContaining({ name: 'local-only', command: 'npx' }),
      expect.objectContaining({
        name: 'workspace-api',
        managedConnectorId: 'connector-new',
        managedConnectorRevision: 5,
        headers: { Authorization: 'Bearer protected' },
      }),
    ]);
    expect(applied.servers.some((server) => server.name === 'old-remote')).toBe(false);
  });

  it('applies only registered non-secret profile settings to the local config', () => {
    const config = {
      configPath: '/tmp/autohand/config.json',
      ui: { showThinking: true },
      permissions: { mode: 'interactive' },
      search: { braveApiKey: 'local-secret' },
    } as LoadedConfig;

    const applied = applyCodingAgentSettingsProfile(config, {
      id: 'profile-1',
      name: 'Focused review',
      settings: {
        'ui.showThinking': false,
        'permissions.mode': 'restricted',
        'search.braveApiKey': 'blocked-at-the-client',
        'unknown.option': true,
      },
      isDefault: true,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    });

    expect(applied).toMatchObject({
      changed: true,
      appliedKeys: ['ui.showThinking', 'permissions.mode'],
    });
    expect(config.ui?.showThinking).toBe(false);
    expect(config.permissions?.mode).toBe('restricted');
    expect(config.search?.braveApiKey).toBe('local-secret');
  });
});
