import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PeerMessaging, type PeerMessagingOptions } from '../../session/peers/PeerMessaging.js';

export async function createPeerHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'ah-peer-test-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'project');
  await mkdir(workspaceRoot, { recursive: true });
  const peers: PeerMessaging[] = [];

  return {
    root, home, workspaceRoot, peers,
    async create(options: Partial<PeerMessagingOptions> = {}) {
      const index = peers.length + 1;
      const peer = new PeerMessaging({
        home, workspaceRoot, sessionId: `session-${index}`, alias: `worker-${index}`,
        policy: { enabled: true, scope: 'workspace', idleBehavior: 'notify' },
        ...options,
      });
      peers.push(peer);
      await peer.start();
      return peer;
    },
    async close() {
      await Promise.allSettled(peers.map(peer => peer.stop()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

export type PeerHarness = Awaited<ReturnType<typeof createPeerHarness>>;
