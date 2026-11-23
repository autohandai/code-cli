/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { devices, metadata } from '../../src/commands/devices.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { MobileConnection } from '../../src/mobile/MobileRelay.js';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const connected: MobileConnection = { pairingId: 'pairing-1', mode: 'steer', connected: true, connectedAt: NOW - 12 * 60_000 };

describe('/devices command', () => {
  it('is registered with an unpair subcommand', () => {
    expect(SLASH_COMMANDS).toContainEqual(expect.objectContaining({ command: '/devices' }));
    expect(metadata.subcommands?.map(sub => sub.name)).toEqual(['unpair']);
  });

  it.each([
    ['no relay was ever started', {}],
    ['the relay has stopped', { connection: () => null }],
  ])('says nothing is paired and how to pair when %s', async (_label, ctx) => {
    const output = await devices(ctx);
    expect(output).toContain('No phone is paired with this session.');
    expect(output).toContain('/mobile');
    expect(await devices(ctx, ['unpair'])).toContain('No phone is paired with this session.');
  });

  it('shows the connected phone, how long it has been connected and how to unpair it', async () => {
    const output = await devices({ connection: () => connected, now: () => NOW });
    expect(output.split('\n')).toContain('✓ Autohand Mobile · connected 12 min ago · steer mode');
    expect(output).toContain('/devices unpair');
  });

  it.each([
    [30_000, 'just now'], [59 * 60_000, '59 min ago'], [3 * 3_600_000, '3 h ago'], [50 * 3_600_000, '2 d ago'], [-5_000, 'just now'],
  ])('describes a connection made %i ms ago as %s', async (age, text) => {
    const output = await devices({ connection: () => ({ ...connected, connectedAt: NOW - age }), now: () => NOW });
    expect(output).toContain(`connected ${text}`);
  });

  it('shows a pairing that is still waiting for the phone', async () => {
    const output = await devices({ connection: () => ({ pairingId: 'pairing-1', mode: 'queue', connected: false }) });
    expect(output).toContain('Waiting for a phone to scan the pairing code · queue mode');
    expect(output).not.toContain('✓');
  });

  it('unpairs the phone and confirms it', async () => {
    const unpair = vi.fn().mockResolvedValue(true);
    const output = await devices({ connection: () => connected, unpair }, ['unpair']);
    expect(unpair).toHaveBeenCalledOnce();
    expect(output).toContain('Phone unpaired.');
  });

  it('reports a pairing that ended first and a revoke that failed without claiming success', async () => {
    expect(await devices({ connection: () => connected, unpair: async () => false }, ['unpair'])).toContain('No phone is paired');
    const failed = await devices({ connection: () => connected, unpair: async () => { throw new Error('network down'); } }, ['unpair']);
    expect(failed).toBe('Could not unpair the phone: network down');
  });

  it.each([['remove'], ['unpair', 'now']])('shows usage for unknown arguments %j', async (...args) => {
    const unpair = vi.fn();
    expect(await devices({ connection: () => connected, unpair }, args)).toBe('Usage: /devices [unpair]');
    expect(unpair).not.toHaveBeenCalled();
  });
});
