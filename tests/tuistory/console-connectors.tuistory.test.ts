import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runConsoleConnectorsScenario } from '../../src/testing/scenarios/consoleConnectorsScenario.js';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('Console connector synchronization in the running CLI', () => {
  it('downloads the selected account before file sync and applies a later deletion without restarting', async () => {
    let revision = 1;
    let deleted = false;
    let toolsListed = 0;
    let accountSelected = false;
    let fileSyncAttempts = 0;
    const api = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/mcp') {
        if (!body.id) { response.writeHead(202).end(); return; }
        let result = {};
        if (body.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
        if (body.method === 'tools/list') {
          toolsListed++;
          result = { tools: [{ name: 'lookup', description: 'Fixture lookup', inputSchema: { type: 'object', properties: {} } }] };
        }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        return;
      }
      if (request.url === '/v1/coding-agent/cli/connectors') {
        accountSelected = request.headers['x-autohand-account-id'] === 'team-fixture';
        response.end(JSON.stringify({ success: true, revision, connectors: deleted ? [] : [{ id: 'console-fixture', name: 'Console Search', transport: 'http', url: `${baseUrl}/mcp`, enabled: true, revision }] }));
      } else if (request.url === '/v1/coding-agent/cli/settings-profiles') {
        response.end(JSON.stringify({ success: true, profiles: [] }));
      } else if (request.url?.startsWith('/v1/coding-agent/')) {
        response.end(JSON.stringify({ success: true }));
      } else {
        fileSyncAttempts++;
        response.writeHead(400).end(JSON.stringify({ error: 'File sync fixture unavailable' }));
      }
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const address = api.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not listen');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: {
      api: { baseUrl, accountId: 'team-fixture' },
      sync: { enabled: true, interval: 600_000 },
      mcp: { enabled: true, servers: [] },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth`, AUTOHAND_API_URL: baseUrl, AUTOHAND_SYNC_API_URL: baseUrl },
      });
      await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
      await expect.poll(() => toolsListed, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(accountSelected).toBe(true);
      await expect.poll(() => fileSyncAttempts).toBeGreaterThan(0);
      const saved = JSON.parse(await readFile(state.configPath, 'utf8'));
      expect(saved.mcp.servers[0]).toMatchObject({ name: 'Console-Search', managedConnectorId: 'console-fixture' });
      await runConsoleConnectorsScenario(session, () => { deleted = true; revision++; }, async () => {
        await expect.poll(async () => JSON.parse(await readFile(state.configPath, 'utf8')).mcp.servers, { timeout: 10_000 }).toEqual([]);
      });
    } finally {
      if (session) await exitInteractive(session);
      api.closeAllConnections();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await auth.close();
      await state.cleanup();
    }
  }, 60_000);
});
