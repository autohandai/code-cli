/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';
import type { PeerAwarenessManager } from '../../src/session/peers/PeerAwarenessManager.js';

const mockPeers = vi.fn();
vi.mock('../../src/commands/peers.js', () => ({
  peers: mockPeers,
}));

const mockFormatPeerCards = vi.fn();
vi.mock('../../src/session/peers/PeerFormatter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/session/peers/PeerFormatter.js')>()),
  formatPeerCards: mockFormatPeerCards,
}));

async function createHandler(ctx: Record<string, unknown>) {
  const { SlashCommandHandler } = await import('../../src/core/slashCommandHandler.js');
  return new SlashCommandHandler(ctx, [
    { command: '/peers', description: 'show peers', implemented: true },
  ]);
}

function createContext(peerAwareness?: PeerAwarenessManager): Record<string, unknown> {
  return {
    peerAwareness,
    config: {
      provider: 'openrouter',
      features: {},
    },
    workspaceRoot: '/tmp/workspace',
    memoryManager: {
      recordCapabilityUse: vi.fn().mockResolvedValue(undefined),
    },
    onBeforeModal: vi.fn(),
    onAfterModal: vi.fn(),
  };
}

function peer(sessionId: string): ActiveAgentRecord {
  return {
    version: 1,
    pid: 4242,
    sessionId,
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    mode: 'interactive',
    status: 'working',
    startedAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:05:00.000Z',
    messageCount: 1,
    contextPercent: 10,
    tokensUsed: 0,
  };
}

describe('/peers command', () => {
  it('forwards the peer awareness manager from the slash command context', async () => {
    const manager = { getPeers: () => [peer('peer-1')] } as unknown as PeerAwarenessManager;
    mockPeers.mockResolvedValueOnce('PEERS_OUTPUT');
    const handler = await createHandler(createContext(manager));

    const result = await handler.handle('/peers');

    expect(mockPeers).toHaveBeenCalledTimes(1);
    expect(mockPeers).toHaveBeenCalledWith({ peerAwareness: manager });
    expect(result).toBe('PEERS_OUTPUT');
  });

  it('renders peer cards from the manager snapshot', async () => {
    const { peers } = await import('../../src/commands/peers.js');
    const manager = {
      getPeers: () => [peer('peer-1'), peer('peer-2')],
    } as unknown as PeerAwarenessManager;

    const output = await peers({ peerAwareness: manager });

    expect(mockFormatPeerCards).toHaveBeenCalledWith([peer('peer-1'), peer('peer-2')]);
    expect(output).toBe(mockFormatPeerCards.mock.results[0]?.value);
  });

  it('reports availability instead of rendering when peer awareness is off', async () => {
    const { peers } = await import('../../src/commands/peers.js');

    const output = await peers({});

    expect(output).toContain('Peer awareness not available.');
    expect(mockFormatPeerCards).not.toHaveBeenCalled();
  });
});
