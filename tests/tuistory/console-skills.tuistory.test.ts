import { createServer } from 'node:http';
import { copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('Console skills in the running CLI', () => {
  it.each([false, true])('automatically applies additions and revocations (custom profile: %s)', async customProfile => {
    let revision = 1; let enabled = true; let removed = false; let acknowledged = 0;
    const api = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/skill-library') {
        expect(request.headers['x-autohand-account-id']).toBe('team-fixture');
        response.end(JSON.stringify({ success: true, accountId: 'team-fixture', revision, skills: removed ? [] : [{ id: 'console-review', name: 'console-review', description: 'Review with account guidance.', instructions: 'Check the Console skill runtime.', source: 'custom', enabled }] }));
      } else if (request.url === '/v1/skill-library/ack') {
        acknowledged = body.revision; response.end(JSON.stringify({ success: true }));
      } else if (request.url === '/v1/coding-agent/cli/connectors') {
        response.end(JSON.stringify({ success: true, revision: 0, connectors: [] }));
      } else if (request.url === '/v1/coding-agent/cli/settings-profiles') {
        response.end(JSON.stringify({ success: true, profiles: [] }));
      } else if (request.url?.startsWith('/v1/coding-agent/')) response.end(JSON.stringify({ success: true }));
      else response.writeHead(400).end(JSON.stringify({ error: 'File sync not part of this fixture' }));
    });
    await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
    const address = api.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not listen');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: { api: { baseUrl, accountId: 'team-fixture' }, sync: { enabled: true, interval: 1500 } } });
    const configPath = customProfile ? path.join(state.autohandHome, 'work-profile.json') : state.configPath;
    if (customProfile) await copyFile(state.configPath, configPath);
    const snapshotPath = customProfile
      ? path.join(state.autohandHome, '.account-skills', 'profiles', createHash('sha256').update(path.resolve(configPath)).digest('hex'), 'snapshot.json')
      : path.join(state.autohandHome, '.account-skills', 'snapshot.json');
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', configPath], { autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth`, AUTOHAND_API_URL: baseUrl, AUTOHAND_SYNC_API_URL: baseUrl } });
      await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
      await expect.poll(() => acknowledged, { timeout: 15_000 }).toBe(1);
      await session.type('/skills info console-review'); await session.press('enter');
      await session.text({ timeout: 10_000, waitFor: text => text.includes('Review with account guidance.') });
      enabled = false; revision = 2;
      await expect.poll(() => acknowledged, { timeout: 10_000 }).toBe(2);
      await session.type('/skills use console-review'); await session.press('enter');
      await session.text({ timeout: 10_000, waitFor: text => text.includes('not found') });
      enabled = true; revision = 3;
      await expect.poll(() => acknowledged, { timeout: 10_000 }).toBe(3);
      const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
      expect(snapshot.skills[0].enabled).toBe(true);
      removed = true; revision = 4;
      await expect.poll(() => acknowledged, { timeout: 10_000 }).toBe(4);
      expect(JSON.parse(await readFile(snapshotPath, 'utf8')).skills).toEqual([]);
    } finally {
      if (session) await exitInteractive(session);
      api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve()));
      await auth.close(); await state.cleanup();
    }
  }, 60_000);
});
