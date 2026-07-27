/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ActiveAgentRegistry,
  type ActiveAgentRecord,
} from '../../../src/session/ActiveAgentRegistry.js';
import { PeerAwarenessManager } from '../../../src/session/peers/PeerAwarenessManager.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fse.remove(root)));
});

async function createRegistry(): Promise<ActiveAgentRegistry> {
  const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-peers-'));
  tempRoots.push(dir);
  return new ActiveAgentRegistry(dir, { isPidAlive: () => true });
}

function record(sessionId: string, workspaceRoot: string): ActiveAgentRecord {
  return {
    version: 1,
    pid: process.pid,
    sessionId,
    workspaceRoot,
    projectName: 'repo',
    provider: 'openrouter',
    model: 'claude',
    mode: 'interactive',
    status: 'working',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 1,
    contextPercent: 99,
    tokensUsed: 0,
    activity: { phase: 'editing', pathsWritten: ['src/a.ts'] },
  };
}

describe('PeerAwarenessManager', () => {
  it('excludes its own session and records from other workspaces', async () => {
    const registry = await createRegistry();
    await registry.write(record('me', '/repo'));
    await registry.write(record('peer', '/repo'));
    await registry.write(record('elsewhere', '/other'));
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo',
      sessionId: 'me',
      tier: 'warn',
      registry,
    });

    await manager.refresh();

    expect(manager.getPeers().map((entry) => entry.sessionId)).toEqual(['peer']);
  });

  it('reports joins and leaves between refreshes', async () => {
    const registry = await createRegistry();
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo',
      sessionId: 'me',
      tier: 'warn',
      registry,
    });

    await registry.write(record('peer', '/repo'));
    expect((await manager.refresh()).joined.map((entry) => entry.sessionId)).toEqual(['peer']);
    await registry.remove('peer');
    expect((await manager.refresh()).left.map((entry) => entry.sessionId)).toEqual(['peer']);
  });

  it('warns on external drift once and adopts its own git mutations', async () => {
    const registry = await createRegistry();
    let sha = 'aaa';
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo',
      sessionId: 'me',
      tier: 'warn',
      registry,
      readHead: async () => ({ branch: 'main', sha }),
    });

    expect((await manager.refresh()).warnings).toEqual([]);
    sha = 'bbb';
    expect((await manager.refresh()).warnings.map((warning) => warning.kind))
      .toEqual(['repo-drift']);
    expect((await manager.refresh()).warnings).toEqual([]);
    sha = 'ccc';
    await manager.adoptRepoBaseline();
    expect((await manager.refresh()).warnings).toEqual([]);
  });

  it('detects peer writes, claims, and files changed since this session read them', async () => {
    const registry = await createRegistry();
    const claiming = record('peer', '/repo');
    claiming.activity = {
      phase: 'editing',
      pathsWritten: ['src/a.ts'],
      claims: ['src/claimed.ts'],
    };
    await registry.write(claiming);
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo',
      sessionId: 'me',
      tier: 'coordinate',
      registry,
    });
    await manager.refresh();

    expect(manager.warnForWrite('src/a.ts', 10).map((warning) => warning.kind))
      .toContain('file-collision');
    expect(manager.warnForWrite('src/claimed.ts', 10).map((warning) => warning.kind))
      .toContain('claim-conflict');
    manager.recordRead('src/drifted.ts', 10);
    expect(manager.warnForWrite('src/drifted.ts', 11).map((warning) => warning.kind))
      .toContain('file-collision');
  });

  it('keeps newest written paths and coordinate claims bounded for publication', () => {
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo',
      sessionId: 'me',
      tier: 'coordinate',
    });

    for (let index = 0; index < 30; index += 1) {
      manager.recordWrite(`src/f${index}.ts`);
    }

    expect(manager.getPathsWritten()).toHaveLength(20);
    expect(manager.getPathsWritten()[0]).toBe('src/f29.ts');
    expect(manager.getClaims()).toHaveLength(20);
  });
});
