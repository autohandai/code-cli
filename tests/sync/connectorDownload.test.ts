import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyManagedConnectors, CodingAgentControlPlaneClient, syncCodingAgentControlPlane } from '../../src/sync/CodingAgentControlPlane.js';
import type { LoadedConfig } from '../../src/types.js';

const mocks = vi.hoisted(() => ({ saveConfig: vi.fn() }));
vi.mock('../../src/config.js', () => ({ saveConfig: mocks.saveConfig }));
vi.mock('fs-extra', () => ({ default: { ensureDir: vi.fn(), pathExists: vi.fn().mockResolvedValue(true), readFile: vi.fn().mockResolvedValue('device-fixture') } }));

const connector = { id: 'remote-1', name: 'Parallel Search', transport: 'http' as const, url: 'https://search.parallel.ai/mcp', enabled: true, revision: 1 };
const config = (): LoadedConfig => ({ configPath: '/tmp/connector-fixture/config.json', mcp: { servers: [] } });

describe('Console connector downloads', () => {
  beforeEach(() => { mocks.saveConfig.mockResolvedValue(undefined); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.saveConfig.mockReset(); });

  it('uses tool-safe managed names and keeps local servers when names collide', () => {
    const local = { name: 'parallel-search', transport: 'stdio' as const, command: 'node', args: ['local.mjs'] };
    const loaded = { ...config(), mcp: { servers: [local] } };
    const result = applyManagedConnectors(loaded, 1, [connector]);
    expect(result.servers[0]).toEqual(local);
    expect(result.servers[1].name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(new Set(result.servers.map((server) => server.name)).size).toBe(2);
    expect(applyManagedConnectors(loaded, 1, [connector]).changed).toBe(false);
  });

  it('adopts an identical published local server instead of duplicating it', () => {
    const loaded = { ...config(), mcp: { servers: [{ name: connector.name, transport: connector.transport, url: connector.url }] } };
    const result = applyManagedConnectors(loaded, 1, [connector]);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].managedConnectorId).toBe(connector.id);
  });

  it('validates the entire snapshot before replacing any saved connector', () => {
    const loaded = config();
    const previous = JSON.stringify(loaded);
    expect(() => applyManagedConnectors(loaded, 1, [connector, { ...connector, id: 'bad', transport: 'stdio' as const, command: '' }])).toThrow(/connector/i);
    expect(JSON.stringify(loaded)).toBe(previous);
    expect(() => applyManagedConnectors(loaded, 1, [connector, connector])).toThrow(/connector/i);
  });

  it('downloads before optional publication and applies runtime settings before reporting metadata failures', async () => {
    const loaded = { ...config(), mcp: { servers: [{ name: 'local-only', transport: 'stdio' as const, command: 'node' }] } };
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const route = new URL(url).pathname;
      events.push(`${init.method}:${route}`);
      if (route.endsWith('/cli/connectors')) return Response.json({ success: true, revision: 1, connectors: [connector] });
      if (route.endsWith('/settings-profiles')) return Response.json({ success: true, profiles: [] });
      if (route.endsWith('/settings-snapshot')) return Response.json({ error: 'Snapshot unavailable' }, { status: 503 });
      return Response.json({ success: true });
    }));
    await expect(syncCodingAgentControlPlane(loaded, 'test-session', { onMcpApplied: () => { events.push('runtime-applied'); } })).rejects.toThrow('Snapshot unavailable');
    expect(events).not.toContain('POST:/v1/coding-agent/connectors');
    expect(events.indexOf('runtime-applied')).toBeLessThan(events.indexOf('PUT:/v1/coding-agent/settings-snapshot'));
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(loaded.mcp?.servers.some((server) => server.managedConnectorId === connector.id)).toBe(true);
  });

  it('does not mutate live config or acknowledge a snapshot when persistence fails', async () => {
    const loaded = config();
    mocks.saveConfig.mockRejectedValue(new Error('Disk full'));
    const acknowledge = vi.spyOn(CodingAgentControlPlaneClient.prototype, 'acknowledgeConnectors');
    vi.spyOn(CodingAgentControlPlaneClient.prototype, 'pullConnectors').mockResolvedValue({ revision: 1, connectors: [connector] });
    vi.spyOn(CodingAgentControlPlaneClient.prototype, 'pullSettingsProfiles').mockResolvedValue([]);
    const apply = vi.fn();
    await expect(syncCodingAgentControlPlane(loaded, 'test-session', { onMcpApplied: apply })).rejects.toThrow('Disk full');
    expect(loaded.mcp?.servers).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing and insecure API base URLs before sending credentials', async () => {
    expect(() => new CodingAgentControlPlaneClient({ ...config(), api: { baseUrl: 'http://untrusted.example' } })).toThrow(/URL/i);
    expect(() => new CodingAgentControlPlaneClient({ ...config(), api: { baseUrl: 'https://user:password@example.com' } })).toThrow(/URL/i);
  });

  it('requests the selected Console account on every control-plane request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, revision: 1, connectors: [connector] }));
    vi.stubGlobal('fetch', fetch);
    const client = new CodingAgentControlPlaneClient({ ...config(), api: { accountId: 'team-fixture' } });
    await client.pullConnectors('test-session', 'device-fixture');
    expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Autohand-Account-Id')).toBe('team-fixture');
  });

  it('retries runtime application after saving succeeded but the runtime callback failed', async () => {
    const loaded = config();
    vi.spyOn(CodingAgentControlPlaneClient.prototype, 'pullConnectors').mockResolvedValue({ revision: 1, connectors: [connector] });
    vi.spyOn(CodingAgentControlPlaneClient.prototype, 'pullSettingsProfiles').mockResolvedValue([]);
    const acknowledge = vi.spyOn(CodingAgentControlPlaneClient.prototype, 'acknowledgeConnectors').mockResolvedValue();
    vi.spyOn(CodingAgentControlPlaneClient.prototype, 'uploadSettingsSnapshot').mockResolvedValue();
    const apply = vi.fn().mockRejectedValueOnce(new Error('Runtime unavailable')).mockResolvedValue(undefined);
    await expect(syncCodingAgentControlPlane(loaded, 'test-session', { onMcpApplied: apply })).rejects.toThrow('Runtime unavailable');
    expect(acknowledge).not.toHaveBeenCalled();
    await syncCodingAgentControlPlane(loaded, 'test-session', { onMcpApplied: apply });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();
  });
});
