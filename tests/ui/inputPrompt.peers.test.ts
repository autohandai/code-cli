import { describe, expect, it } from 'vitest';
import { getPrimaryHotTipSuggestion } from '../../src/ui/inputPrompt.js';
import type { PeerDescriptor } from '../../src/session/peers/PeerProtocol.js';

const peer: PeerDescriptor = { peerId: 'peer-builder', instanceId: 'builder', sessionId: 'builder-session', alias: 'builder', project: 'Project', kind: 'root', activity: 'idle', availability: 'available', capabilities: ['message.receive'] };

describe('fallback input peer completion', () => {
  it('uses the same alias completion and binds an opaque recipient', () => {
    const suggestion = getPrimaryHotTipSuggestion('Tell :bu', [], [], { peersProvider: () => [peer] });
    expect(suggestion).toMatchObject({ line: 'Tell :builder ', cursor: 14, peerReference: { peerId: peer.peerId, instanceId: peer.instanceId } });
  });

  it.each(['https://host:3000', '12:30', 'C:\\src', 'package:script', ':smile:', '\\:builder', '`literal :builder`', '/help :builder', '!echo :builder'])('preserves literal/command syntax %s', text => {
    expect(getPrimaryHotTipSuggestion(text, [], [], { peersProvider: () => [peer] })?.peerReference).toBeUndefined();
  });

  it('preserves existing file completion when peer communication is enabled', () => {
    expect(getPrimaryHotTipSuggestion('@src', ['src/index.ts'], [], { peersProvider: () => [peer] })).toMatchObject({ line: '@src/index.ts ' });
  });
});
