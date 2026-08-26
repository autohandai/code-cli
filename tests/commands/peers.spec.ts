/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  // Call history accumulates across tests otherwise, so a later "was never
  // called" assertion would see an earlier test's call.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the peer awareness manager from the slash command context', async () => {
    const manager = { getPeers: () => [peer('peer-1')] } as unknown as PeerAwarenessManager;
    mockPeers.mockResolvedValueOnce('PEERS_OUTPUT');
    const ctx = createContext(manager);
    const handler = await createHandler(ctx);

    const result = await handler.handle('/peers');

    expect(mockPeers).toHaveBeenCalledTimes(1);
    // The peers screen owns the alternate buffer, so the handler must hand the
    // modal hooks through: without them the main Composer keeps racing the
    // screen for stdin and the session can exit after the screen closes.
    expect(mockPeers).toHaveBeenCalledWith({
      peerAwareness: manager,
      onBeforeModal: ctx.onBeforeModal,
      onAfterModal: ctx.onAfterModal,
    });
    expect(result).toBe('PEERS_OUTPUT');
  });

  it('renders peer cards from the manager snapshot', async () => {
    // vi.mock replaces this module for the handler test above, so the real
    // implementation has to be pulled in explicitly. Its own import of
    // PeerFormatter still resolves to the mock.
    const { peers } = await vi.importActual<typeof import('../../src/commands/peers.js')>(
      '../../src/commands/peers.js',
    );
    const manager = {
      getPeers: () => [peer('peer-1'), peer('peer-2')],
    } as unknown as PeerAwarenessManager;
    // A concrete return value: without one the mock yields undefined and the
    // output assertion below passes even when peers() returns nothing.
    mockFormatPeerCards.mockReturnValueOnce('RENDERED_PEER_CARDS');

    const output = await peers({ peerAwareness: manager });

    expect(mockFormatPeerCards).toHaveBeenCalledWith([peer('peer-1'), peer('peer-2')]);
    expect(output).toBe('RENDERED_PEER_CARDS');
  });

  it('reports availability instead of rendering when peer awareness is off', async () => {
    const { peers } = await vi.importActual<typeof import('../../src/commands/peers.js')>(
      '../../src/commands/peers.js',
    );

    const output = await peers({});

    expect(output).toContain('Peer awareness not available.');
    expect(mockFormatPeerCards).not.toHaveBeenCalled();
  });
});
