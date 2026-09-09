import { describe, expect, it } from 'vitest';
import { bindPeerReference, matchPeerMention, parsePeerInput, resolvePeerInput } from '../../src/ui/peerMention.js';
import type { PeerDescriptor } from '../../src/session/peers/PeerProtocol.js';

const builder: PeerDescriptor = {
  peerId: 'peer-builder-incarnation-a', instanceId: 'incarnation-a', sessionId: 'builder-session',
  alias: 'builder', project: 'Project', kind: 'root', activity: 'idle', availability: 'available',
  capabilities: ['message.send', 'message.receive', 'message.wait'],
};

describe('shared colon mention parsing', () => {
  it.each([
    [':', ''], [':b', 'b'], [':builder-a1', 'builder-a1'],
    ['Tell :builder', 'builder'], ['Tell\t:builder', 'builder'],
    ['Review (:builder', 'builder'],
  ])('matches an address at an unescaped boundary: %s', (text, query) => {
    expect(matchPeerMention(text, text.length)).toMatchObject({ query, end: text.length });
  });

  it.each([
    'https://example.com', 'http://localhost:3000', 'localhost:3000', '12:30',
    'C:\\src', 'package:script', ':smile:', ':1', ':_bad', '\\:builder',
    'Say \\:builder', '`use :builder`', '``use :builder``', '```sh\n:builder',
    '~~~sh\n:builder', '/help :builder', '!echo :builder', 'word:builder',
  ])('does not activate the picker for literal or command input: %s', text => {
    expect(matchPeerMention(text, text.length)).toBeNull();
    expect(parsePeerInput(text).kind).toBe('instruction');
  });

  it('resumes matching after a closed code span or fence', () => {
    for (const text of ['`literal :a` then :builder', '```\n:literal\n```\nTell :builder', '~~~\n:literal\n~~~\nTell :builder']) {
      expect(matchPeerMention(text, text.length)?.query).toBe('builder');
    }
  });

  it('matches at the cursor and preserves trailing text when completing', () => {
    const text = 'Tell :bu about the change';
    const match = matchPeerMention(text, 8);
    expect(match).toMatchObject({ query: 'bu', start: 5, end: 8 });
    if (!match) throw new Error('Expected mention');
    const completion = bindPeerReference(text, match, builder);
    expect(completion.text).toBe('Tell :builder about the change');
    expect(completion.binding).toMatchObject({ peerId: builder.peerId, instanceId: builder.instanceId, alias: 'builder' });
    expect(completion.cursor).toBe(14);
  });

  it('distinguishes a leading direct send from an inline model reference', () => {
    expect(parsePeerInput(':builder compile the patch')).toMatchObject({ kind: 'direct', alias: 'builder', content: 'compile the patch' });
    expect(parsePeerInput('Tell :builder the patch is ready')).toMatchObject({ kind: 'instruction', references: [expect.objectContaining({ alias: 'builder' })] });
    expect(parsePeerInput('  :builder compile')).toMatchObject({ kind: 'direct', alias: 'builder', content: 'compile' });
  });

  it('does not convert multiline paste or an address without a body into a direct send', () => {
    for (const text of [':builder', ':builder ', ':builder first\nsecond', '\x1b[200~:builder copied\x1b[201~']) {
      expect(parsePeerInput(text).kind).toBe('instruction');
    }
  });

  it('extracts only real inline references and preserves literal content', () => {
    const text = 'Ask :builder then :reviewer, skip `:hidden` and \\:literal or :smile:.';
    const parsed = parsePeerInput(text);
    expect(parsed).toMatchObject({ kind: 'instruction', text });
    if (parsed.kind !== 'instruction') throw new Error('Expected instruction');
    expect(parsed.references.map(reference => reference.alias)).toEqual(['builder', 'reviewer']);
  });
});

describe('stable recipient bindings', () => {
  it('resolves a uniquely typed alias to an opaque recipient', () => {
    expect(resolvePeerInput(':builder build now', [], [builder])).toMatchObject({ kind: 'direct', to: builder.peerId, content: 'build now' });
  });

  it('rejects ambiguity instead of selecting the first alias match', () => {
    expect(() => resolvePeerInput(':builder build', [], [builder, { ...builder, peerId: 'peer-other', instanceId: 'other' }])).toThrow(/ambiguous/i);
  });

  it('does not silently retarget a selected draft when a recipient restarts', () => {
    const match = matchPeerMention(':bu', 3);
    if (!match) throw new Error('Expected mention');
    const completion = bindPeerReference(':bu', match, builder);
    const changed = { ...builder, peerId: 'peer-replacement', instanceId: 'replacement' };
    expect(() => resolvePeerInput(`${completion.text}build`, [completion.binding], [changed])).toThrow(/offline|changed|reselect/i);
  });

  it('rejects offline and presence-only targets while keeping the caller’s draft immutable', () => {
    const draft = ':builder build now';
    for (const availability of ['offline', 'presence_only'] as const) {
      expect(() => resolvePeerInput(draft, [], [{ ...builder, availability }])).toThrow();
      expect(draft).toBe(':builder build now');
    }
  });

  it('attaches structured inline references without fetching a peer transcript', () => {
    const resolved = resolvePeerInput('Tell :builder this is ready', [], [builder]);
    expect(resolved).toMatchObject({ kind: 'instruction', references: [expect.objectContaining({ peerId: builder.peerId })] });
    expect(resolved).not.toHaveProperty('transcript');
    expect(resolved).not.toHaveProperty('attachments');
  });
});
