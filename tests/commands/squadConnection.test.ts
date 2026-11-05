import { describe, expect, it, vi } from 'vitest';
import { SquadConnection } from '../../src/squad/SquadConnection.js';
import { message } from '../../src/commands/message.js';
import { runDesktopSquadCommand } from '../../src/commands/squadConnection.js';
import type { Team } from '../../src/core/teams/types.js';

function fixture() {
  const post = vi.fn(async () => ({ id: 'receipt-1', status: 'queued' }));
  const get = vi.fn(async (path: string) => {
    if (path === '/api/status/snapshot') return { members: [{ id: 'kai', name: 'Kai', role: 'Engineer' }] };
    if (path === '/api/members/presence') return { presence: { kai: { state: 'working' } } };
    if (path === '/api/runs') return [{ agentId: 'kai', workspace: '/member/project', startedAt: '2026-11-01' }];
    if (path.startsWith('/api/goals')) return [];
    if (path === '/api/channels') return {};
    if (path.startsWith('/api/queues/')) return { items: [], paused: false };
    if (path.includes('/transcript')) return { messages: [{ role: 'agent', body: 'Ready for review.' }], live: false };
    throw new Error(`Unexpected request ${path}`);
  });
  return { connection: new SquadConnection({ bridge: { get, post, put: vi.fn() } }), post, get };
}

describe('desktop Squad commands', () => {
  it('selects a running Squad agent and sends /message to its durable direct queue', async () => {
    const { connection, post } = fixture();
    const pickMember = vi.fn(async () => 'kai');
    const selected = await runDesktopSquadCommand({ squadConnection: connection, pickMember }, ['select']);
    expect(selected).toContain('Kai');
    expect(pickMember.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'kai', presence: 'working' })]));
    expect(await message({ squadConnection: connection }, ['Please', 'review', 'this.'])).toContain('receipt-1');
    expect(post).toHaveBeenCalledWith('/api/queues/kai/items', { text: 'Please review this.', workspace: '/member/project' });
  });

  it('keeps explicit local team messages working while Squad is selected', async () => {
    const { connection } = fixture();
    await connection.select('Kai');
    const sendMessageTo = vi.fn();
    const teamManager = { getTeam: (): Team => ({ name: 'fixture', leadSessionId: 'lead', createdAt: '', status: 'active', members: [] }), sendMessageTo };
    const response = await message({ squadConnection: connection, teamManager }, ['team', 'local', 'Review', 'this']);
    expect(response).toContain('Message sent to local');
    expect(sendMessageTo).toHaveBeenCalledWith('local', 'lead', 'Review this');
  });

  it('sends to an explicit desktop recipient without requiring a local team', async () => {
    const { connection, post } = fixture();
    expect(await message({ squadConnection: connection }, ['squad', 'kai', 'Hello'])).toContain('receipt-1');
    expect(post).toHaveBeenCalledOnce();
    expect(await runDesktopSquadCommand({ squadConnection: connection }, ['history', 'kai'])).toContain('Ready for review.');
  });

  it('rejects an unknown recipient without queuing anything', async () => {
    const { connection, post } = fixture();
    await expect(connection.select('unknown')).rejects.toThrow(/not found/i);
    expect(post).not.toHaveBeenCalled();
  });
});
