import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Session } from '../../src/session/SessionManager.js';
import type { SessionMessage } from '../../src/session/types.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('durable peer context transcript commits', () => {
  it('records one context entry across concurrent retries and a loaded session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ah-peer-context-'));
    roots.push(root);
    const metadata = { sessionId: 'context-test', projectPath: root, projectName: 'test', model: 'test', messageCount: 0, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), status: 'active' as const };
    const session = new Session(root, metadata);
    const message: SessionMessage = { role: 'user', content: 'external collaboration context', timestamp: metadata.createdAt, _meta: { peerContext: { version: 1 } } };
    await Promise.all([session.appendContext(message, 'commit-1'), session.appendContext(message, 'commit-1')]);
    const resumed = new Session(root, metadata);
    await resumed.load();
    await resumed.appendContext(message, 'commit-1');
    expect(resumed.getMessages()).toHaveLength(1);
    expect((await readFile(path.join(root, 'conversation.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
