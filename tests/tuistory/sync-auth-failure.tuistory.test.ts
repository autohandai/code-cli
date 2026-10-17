import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runSyncAuthFailureScenario } from '../../src/testing/scenarios/syncAuthFailureScenario.js';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('sync authentication failures in the running CLI', () => {
  it.each([
    { name: 'Escape', key: 'escape' as const },
    { name: 'Ctrl+C', key: ['ctrl', 'c'] as const },
  ])('returns to the composer with $name after a sync 401 while still logged in', async ({ key }) => {
    let rejectAuthentication = false;
    let manifestRequests = 0;
    const routes: string[] = [];
    const api = createServer((request, response) => {
      routes.push(request.url ?? '');
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/coding-agent/cli/connectors') {
        response.writeHead(403);
        response.end(JSON.stringify({ error: 'A signed-in Code client is required.' }));
        return;
      }
      if (request.url === '/v1/sync/manifest') {
        manifestRequests++;
        response.writeHead(rejectAuthentication ? 401 : 400);
        response.end(JSON.stringify({ error: rejectAuthentication ? 'Unauthorized' : 'File sync fixture unavailable' }));
        return;
      }
      response.end(JSON.stringify({ success: true, accountId: 'tuistory-test-user', revision: 1, skills: [], connectors: [], profiles: [] }));
    });
    await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
    const address = api.address();
    if (!address || typeof address === 'string') throw new Error('Sync fixture did not listen');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: {
      api: { baseUrl },
      sync: { enabled: true, interval: 600_000 },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth`, AUTOHAND_API_URL: baseUrl },
      });
      try {
        await expect.poll(() => manifestRequests, { timeout: 15_000 }).toBeGreaterThan(0);
      } catch (error) {
        throw new Error(`Sync fixture never reached manifest. Routes: ${routes.join(', ')}\nScreen:\n${await session.text({ immediate: true })}`, { cause: error });
      }
      await runSyncAuthFailureScenario(session, () => { rejectAuthentication = true; }, key);
      expect(session.exitInfo).toBeNull();
      const saved = JSON.parse(await readFile(state.configPath, 'utf8')) as { auth?: { token?: string } };
      expect(saved.auth?.token).toBe('tuistory-test-token');
      await exitInteractive(session);
    } finally {
      session?.close();
      api.closeAllConnections();
      await new Promise<void>(resolve => api.close(() => resolve()));
      await auth.close();
      await state.cleanup();
    }
  }, 45_000);
});
