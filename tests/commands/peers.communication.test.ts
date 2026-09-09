import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peers } from '../../src/commands/peers.js';
import { createPeerHarness, type PeerHarness } from '../../src/testing/scenarios/peerCommunicationHarness.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

describe('/peers communication commands', () => {
  it('sends an explicit opaque target and returns its actual receipt', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const output = await peers({ peerMessaging: sender }, ['send', receiver.self.peerId, 'build', 'now']);
    expect(output).toContain('accepted');
    expect((await receiver.messages()).messages[0].content).toBe('build now');
  });

  it('reports a typed failure without printing a successful send', async () => {
    const sender = await h.create();
    const output = await peers({ peerMessaging: sender }, ['send', 'unknown-target', 'hello']);
    expect(output).toContain('UNKNOWN_TARGET');
    expect(output).not.toMatch(/accepted|Message sent/);
  });

  it('explains how to enable communication while retaining the presence-only command', async () => {
    const output = await peers({}, ['send', 'peer-target', 'hello']);
    expect(output).toContain('sessions.communication.enabled');
  });

  it('validates command syntax and provides scoped discovery and inbox help', async () => {
    const sender = await h.create();
    for (const args of [['send'], ['send', 'peer-target'], ['unexpected']]) {
      const output = await peers({ peerMessaging: sender }, args);
      expect(output).toContain('/peers');
      expect(output).toContain('send');
      expect(output).toContain('inbox');
    }
  });

  it('previews the inbox without consuming messages merely because they were displayed', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'preview this' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const output = await peers({ peerMessaging: receiver }, ['inbox']);
    expect(`${output ?? ''}${log.mock.calls.flat().join('\n')}`).toContain('preview this');
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'accepted' });
  });

  it('replies to the original exact sender using durable message correlation', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'ready?' });
    await receiver.messages();
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'consumed' });
    const output = await peers({ peerMessaging: receiver }, ['reply', receipt.messageId, 'ready']);
    expect(output).toContain('accepted');
    expect((await sender.messages()).messages[0]).toMatchObject({ content: 'ready', replyTo: receipt.messageId });
  });
});
