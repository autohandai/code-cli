/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildMessageTargets,
  buildTargetSuggestions,
  matchTargetMention,
  parseLeadingTargetMessage,
  PEER_MESSAGING_UNAVAILABLE,
} from '../../src/ui/messageTargets.js';
import type { AgentRun } from '../../src/core/agents/AgentRunStore.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';

function run(overrides: Partial<AgentRun> & { id: string; name: string }): AgentRun {
  return {
    source: 'delegate', task: 'Review the diff', agentType: 'reviewer', status: 'running',
    startedAt: 0, updatedAt: 0, cancellable: true, messageable: true, ...overrides,
  };
}

const peer: ActiveAgentRecord = {
  version: 1, pid: 42, sessionId: 'abcdef1234567890', workspaceRoot: '/work', projectName: 'cli', provider: 'autohandai', model: 'moa',
  mode: 'interactive', status: 'idle', startedAt: '', updatedAt: '', messageCount: 0, contextPercent: 0, tokensUsed: 0,
} as ActiveAgentRecord;

describe('matchTargetMention', () => {
  it('matches a bare colon and a partial alias at the start or after whitespace', () => {
    expect(matchTargetMention(':', 1)).toEqual({ seed: '', startIndex: 0 });
    expect(matchTargetMention('tell :rev', 9)).toEqual({ seed: 'rev', startIndex: 5 });
    expect(matchTargetMention('  :Writer', 9)).toEqual({ seed: 'Writer', startIndex: 2 });
  });

  it.each([
    ['meet at 12:30', 13],
    ['open C:\\src', 11],
    ['run package:script', 18],
    ['see https://x.dev', 17],
    ['literal \\:name', 14],
    ['emoji :smile:', 13],
    ['mid:word', 8],
    ['digits :42', 10],
  ])('ignores %j', (text, cursor) => {
    expect(matchTargetMention(text, cursor)).toBeNull();
  });

  it('only looks before the cursor', () => {
    expect(matchTargetMention(':rev later text', 4)).toEqual({ seed: 'rev', startIndex: 0 });
  });
});

describe('buildMessageTargets', () => {
  it('lists runs, teammates, and peers with unique aliases and availability', () => {
    const targets = buildMessageTargets({
      runs: [
        run({ id: 'subagent-1111aaaa', name: 'reviewer' }),
        run({ id: 'subagent-2222bbbb', name: 'reviewer', task: 'Second review' }),
        run({ id: 'subagent-3333cccc', name: 'Docs Writer', status: 'completed' }),
        run({ id: 'squad-1', name: 'external', source: 'squad' }),
        run({ id: 'subagent-4444dddd', name: 'tester', cancelRequested: true }),
      ],
      teammates: [
        { name: 'builder', agentName: 'implementer', pid: 1, status: 'working' },
        { name: 'reviewer', agentName: 'reviewer', pid: 2, status: 'shutdown' },
      ],
      peers: [peer],
    });

    expect(targets.map((target) => target.alias)).toEqual([
      'reviewer-aaaa', 'reviewer-bbbb', 'docs-writer', 'tester', 'builder', 'reviewer', 'peer-abcdef12',
    ]);
    expect(targets.find((target) => target.alias === 'docs-writer')).toMatchObject({ messageable: false, reason: 'finished' });
    expect(targets.find((target) => target.alias === 'tester')).toMatchObject({ messageable: false, reason: 'stopping' });
    expect(targets.find((target) => target.alias === 'builder')).toMatchObject({ kind: 'teammate', id: 'builder', messageable: true });
    expect(targets.find((target) => target.alias === 'reviewer')).toMatchObject({ kind: 'teammate', messageable: false, reason: 'shut down' });
    expect(targets.find((target) => target.kind === 'peer')).toMatchObject({
      id: 'abcdef1234567890', messageable: false, reason: PEER_MESSAGING_UNAVAILABLE, detail: 'peer session · cli · moa',
    });
    expect(targets.some((target) => target.label === 'external')).toBe(false);
  });
});

describe('buildTargetSuggestions', () => {
  const targets = buildMessageTargets({
    runs: [run({ id: 'a', name: 'reviewer' }), run({ id: 'b', name: 'researcher', status: 'completed' })],
    teammates: [{ name: 'builder', agentName: 'implementer', pid: 1, status: 'idle' }],
  });

  it('lists everything for a bare colon with reachable targets first', () => {
    expect(buildTargetSuggestions('', targets).map((s) => s.alias)).toEqual([':builder', ':reviewer', ':researcher']);
  });

  it('ranks prefix matches ahead of substring matches and keeps the colon prefix', () => {
    expect(buildTargetSuggestions('re', targets).map((s) => s.alias)).toEqual([':reviewer', ':researcher']);
    expect(buildTargetSuggestions('ild', targets).map((s) => s.alias)).toEqual([':builder']);
    expect(buildTargetSuggestions('zzz', targets)).toEqual([]);
  });
});

describe('parseLeadingTargetMessage', () => {
  const targets = buildMessageTargets({ runs: [run({ id: 'a', name: 'reviewer' }), run({ id: 'b', name: 'builder' })] });

  it('parses ":alias message" case-insensitively', () => {
    expect(parseLeadingTargetMessage(':Reviewer please focus on tests', targets))
      .toMatchObject({ target: { alias: 'reviewer' }, message: 'please focus on tests' });
    expect(parseLeadingTargetMessage('  :builder   ', targets)).toMatchObject({ message: '' });
  });

  it('is not a send for unknown aliases, mid-sentence references, or multi-line input', () => {
    expect(parseLeadingTargetMessage(':ghost hello', targets)).toBeNull();
    expect(parseLeadingTargetMessage('tell :reviewer hello', targets)).toBeNull();
    expect(parseLeadingTargetMessage(':reviewer line one\nline two', targets)).toBeNull();
    expect(parseLeadingTargetMessage(':smile: hi', targets)).toBeNull();
  });
});
