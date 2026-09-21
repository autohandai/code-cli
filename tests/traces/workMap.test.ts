import { describe, expect, it } from 'vitest';
import {
  createCanonicalTraceId,
  projectTraceForUpload,
  type NormalizedTrace,
  type TraceHarness,
} from '../../src/traces/model.js';
import { deriveWorkMap, projectTraceForLocalIndex } from '../../src/traces/workMap.js';

function trace(
  harness: TraceHarness,
  externalId: string,
  overrides: Partial<NormalizedTrace> = {},
): NormalizedTrace {
  const recordPath = `/Users/private/work/${externalId}.jsonl`;
  return {
    schemaVersion: 1,
    id: createCanonicalTraceId(harness, externalId, recordPath),
    source: {
      harness,
      externalId,
      recordPath,
      fingerprint: `sha256:${externalId}`,
    },
    agent: { name: harness },
    project: {
      name: 'secret-repository',
      path: '/Users/private/work/secret-repository',
      gitRemote: 'https://token@github.com/private/secret.git',
    },
    startedAt: '2026-09-17T00:00:00.000Z',
    endedAt: '2026-09-17T00:02:00.000Z',
    status: 'completed',
    model: 'gpt-6',
    provider: 'openai',
    reasoningEffort: 'high',
    usage: { input: 100, output: 25, reasoning: 5, total: 130, provenance: 'actual' },
    relationships: [],
    messages: [
      {
        id: `${externalId}-1`,
        role: 'user',
        order: 0,
        usage: { provenance: 'unavailable' },
        parts: [{ type: 'text', text: 'secret prompt github_pat_NEVER_SERIALIZE' }],
      },
      {
        id: `${externalId}-2`,
        role: 'assistant',
        order: 1,
        usage: { provenance: 'unavailable' },
        parts: [
          { type: 'reasoning', text: 'private chain of thought' },
          { type: 'tool_call', name: 'read_file', arguments: { path: '/Users/private/source.ts' } },
          { type: 'tool_call', name: 'write_file', arguments: { contents: 'secret source' } },
          { type: 'tool_call', name: 'run_command', arguments: { command: 'bun test' } },
          { type: 'tool_result', name: 'run_command', content: '12 tests passed' },
        ],
      },
    ],
    outcome: {
      state: 'verified',
      facts: ['files_changed', 'tests_passed'],
      confidence: 'high',
    },
    provenance: {
      adapterVersion: 1,
      parsedAt: '2026-09-18T00:00:00.000Z',
      completeness: 'complete',
      warnings: [],
    },
    ...overrides,
  };
}

describe('deriveWorkMap', () => {
  it('derives bounded usage, outcome, tool, and workflow aggregates', () => {
    const result = deriveWorkMap([
      trace('autohand', 'one'),
      trace('codex', 'two', {
        status: 'failed',
        outcome: { state: 'failed', facts: ['tests_failed', 'tool_error'], confidence: 'high' },
      }),
    ], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      workspace: '/Users/private/work/secret-repository',
      coverage: [
        { harness: 'autohand', filesScanned: 1, bytesRead: 100, warnings: 0, truncated: false, sessions: 1 },
        { harness: 'codex', filesScanned: 1, bytesRead: 100, warnings: 1, truncated: true, sessions: 1 },
      ],
    });

    expect(result.sessions).toMatchObject({ total: 2, completed: 1, failed: 1, tokens: 260 });
    expect(result.outcomes).toMatchObject({ verified: 1, failed: 1 });
    expect(result.dimensions.harnesses).toEqual([
      { name: 'autohand', sessions: 1, tokens: 130 },
      { name: 'codex', sessions: 1, tokens: 130 },
    ]);
    expect(result.dimensions.models).toEqual([{ name: 'gpt-6', sessions: 2, tokens: 260 }]);
    expect(result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'read', calls: 2 }),
      expect.objectContaining({ category: 'edit', calls: 2 }),
      expect.objectContaining({ category: 'test', calls: 2 }),
    ]));
    expect(result.workflows[0]).toMatchObject({ motif: 'inspect -> edit -> test', occurrences: 2 });
    expect(result.coverage).toMatchObject({ sessions: 2, partial: true, warnings: 1 });
  });

  it('does not double-count Codex cache and reasoning subsets when total is absent', () => {
    const result = deriveWorkMap([trace('codex', 'inclusive-usage', {
      usage: { input: 10, output: 6, reasoning: 2, cacheRead: 4, provenance: 'actual' },
    })], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      coverage: [],
    });

    expect(result.sessions.tokens).toBe(16);
    expect(result.dimensions.harnesses[0]?.tokens).toBe(16);
  });

  it('attributes a multi-model session by message usage in fresh and cached maps', () => {
    const multiModel = trace('cline', 'mixed-model', {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      usage: { input: 27, output: 12, total: 39, provenance: 'actual' },
      messages: [
        { id: 'm1', role: 'assistant', order: 0, model: 'claude-sonnet-4-6',
          usage: { input: 21, output: 8, provenance: 'actual' },
          parts: [{ type: 'text', text: 'private first response' }] },
        { id: 'm2', role: 'assistant', order: 1, model: 'gpt-6',
          usage: { input: 6, output: 4, provenance: 'actual' },
          parts: [{ type: 'text', text: 'private second response' }] },
      ],
    });
    const options = { now: new Date('2026-09-18T00:00:00.000Z'), since: '30d', coverage: [] };

    const fresh = deriveWorkMap([multiModel], options);
    const cachedTrace = projectTraceForLocalIndex(multiModel);
    const cached = deriveWorkMap([cachedTrace], options);

    expect(fresh.sessions.tokens).toBe(39);
    expect(fresh.dimensions.models).toEqual([
      { name: 'claude-sonnet-4-6', sessions: 1, tokens: 29 },
      { name: 'gpt-6', sessions: 1, tokens: 10 },
    ]);
    expect(cached.dimensions.models).toEqual(fresh.dimensions.models);
    expect(JSON.stringify(cachedTrace)).not.toContain('private first response');
    expect(JSON.stringify(cachedTrace)).not.toContain('private second response');
  });

  it('leaves unmeasured tokens unattributed in a multi-model session', () => {
    const partial = trace('cline', 'partial-model-usage', {
      model: 'claude-sonnet-4-6',
      usage: { total: 50, provenance: 'actual' },
      messages: [
        { id: 'm1', role: 'assistant', order: 0, model: 'claude-sonnet-4-6',
          usage: { total: 29, provenance: 'actual' }, parts: [{ type: 'text', text: 'first' }] },
        { id: 'm2', role: 'assistant', order: 1, model: 'gpt-6',
          usage: { provenance: 'unavailable' }, parts: [{ type: 'text', text: 'second' }] },
      ],
    });
    const result = deriveWorkMap([partial], {
      now: new Date('2026-09-18T00:00:00.000Z'), since: '30d', coverage: [],
    });

    expect(result.dimensions.models).toEqual([
      { name: 'claude-sonnet-4-6', sessions: 1, tokens: 29 },
      { name: 'unattributed', sessions: 1, tokens: 21 },
    ]);
  });

  it('does not assign unmeasured usage to stale session model metadata', () => {
    const result = deriveWorkMap([trace('cline', 'stale-model', {
      model: 'old-model',
      usage: { total: 25, provenance: 'actual' },
      messages: [{ id: 'm1', role: 'assistant', order: 0, model: 'new-model',
        usage: { provenance: 'unavailable' }, parts: [{ type: 'text', text: 'reply' }] }],
    })], {
      now: new Date('2026-09-18T00:00:00.000Z'), since: '30d', coverage: [],
    });

    expect(result.dimensions.models).toEqual([{ name: 'unattributed', sessions: 1, tokens: 25 }]);
  });

  it('serializes no raw content, identifiers, paths, remotes, or secrets', () => {
    const result = deriveWorkMap([trace('autohand', 'private-session-id')], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      workspace: '/Users/private/work/secret-repository',
      coverage: [],
    });
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      'secret prompt',
      'private chain of thought',
      'github_pat_NEVER_SERIALIZE',
      '/Users/private',
      'secret-repository',
      'private-session-id',
      'token@github.com',
      'bun test',
      'secret source',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result.privacy).toEqual(expect.objectContaining({
      contentProcessedLocally: true,
      networkRequests: false,
      persistedRawContent: false,
    }));
  });

  it('filters sessions outside the requested window and workspace', () => {
    const result = deriveWorkMap([
      trace('autohand', 'included'),
      trace('codex', 'old', { startedAt: '2026-07-01T00:00:00.000Z' }),
      trace('claude-code', 'elsewhere', {
        project: { path: '/Users/private/other' },
      }),
    ], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      workspace: '/Users/private/work/secret-repository',
      coverage: [],
    });

    expect(result.sessions.total).toBe(1);
    expect(result.dimensions.harnesses).toEqual([{ name: 'autohand', sessions: 1, tokens: 130 }]);
  });

  it('counts nonzero tool exits as aggregate errors', () => {
    const failedTest = trace('autohand', 'failed-test', {
      status: 'failed',
      messages: [{
        id: 'failed-test-message',
        role: 'assistant',
        order: 0,
        usage: { provenance: 'unavailable' },
        parts: [
          { type: 'tool_call', name: 'run_command', callId: 'test-1', arguments: { command: 'bun test' } },
          { type: 'tool_result', name: 'run_command', callId: 'test-1', exitCode: 1 },
        ],
      }],
    });
    const indexed = projectTraceForLocalIndex(failedTest);

    const result = deriveWorkMap([indexed], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      coverage: [],
    });

    expect(result.tools).toContainEqual({ category: 'test', calls: 1, errors: 1, sessions: 1 });
  });

  it('correlates raw command results with their categorized tool calls', () => {
    const failedTest = trace('codex', 'raw-failed-test', {
      messages: [{
        id: 'raw-failed-test-message',
        role: 'assistant',
        order: 0,
        usage: { provenance: 'unavailable' },
        parts: [
          { type: 'tool_call', name: 'run_command', callId: 'test-1', arguments: { command: 'bun test' } },
          { type: 'tool_result', name: 'run_command', callId: 'test-1', exitCode: 1 },
        ],
      }],
    });

    const result = deriveWorkMap([failedTest], {
      now: new Date('2026-09-18T00:00:00.000Z'),
      since: '30d',
      coverage: [],
    });

    expect(result.tools).toContainEqual({ category: 'test', calls: 1, errors: 1, sessions: 1 });
    expect(result.tools).not.toContainEqual(expect.objectContaining({ category: 'other', errors: 1 }));
  });

  it('projects an incremental local index without retaining private content', () => {
    const original = trace('autohand', 'private-session-id');
    const indexed = projectTraceForLocalIndex(original);
    const serialized = JSON.stringify(indexed);

    expect(indexed.id).toBe(original.id);
    expect(indexed.source.externalId).not.toBe(original.source.externalId);
    expect(indexed.messages.flatMap((message) => message.parts)).toEqual([
      expect.objectContaining({ type: 'tool_call', name: 'read' }),
      expect.objectContaining({ type: 'tool_call', name: 'edit' }),
      expect.objectContaining({ type: 'tool_call', name: 'test' }),
    ]);
    for (const forbidden of [
      'secret prompt',
      'private chain of thought',
      'private-session-id',
      '/Users/private',
      'secret-repository',
      'token@github.com',
      'bun test',
      'secret source',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(deriveWorkMap([indexed], {
      since: '30d',
      now: new Date('2026-09-18T00:00:00.000Z'),
      coverage: [],
    }).workflows[0]).toMatchObject({ motif: 'inspect -> edit -> test' });
  });

  it('makes noncanonical trace and relationship identifiers opaque before persistence or upload', () => {
    const privateTraceId = 'native-session-private-parent';
    const privateRelationshipId = 'native-session-private-child';
    const original = trace('autohand', 'private-session-id', {
      id: privateTraceId,
      relationships: [{ type: 'child', traceId: privateRelationshipId }],
    });

    const indexed = projectTraceForLocalIndex(original);
    const uploaded = projectTraceForUpload(original, 'metadata');
    const serialized = JSON.stringify({ indexed, uploaded });

    expect(indexed.id).toMatch(/^tr_[a-f0-9]{32}$/u);
    expect(indexed.relationships[0]?.traceId).toMatch(/^tr_[a-f0-9]{32}$/u);
    expect(uploaded.traceId).toBe(indexed.id);
    expect(uploaded.relationships).toEqual(indexed.relationships);
    expect(serialized).not.toContain(privateTraceId);
    expect(serialized).not.toContain(privateRelationshipId);
  });

  it('preserves the native ID hash when a metadata upload is projected from the safe cache', () => {
    const original = trace('codex', 'private-session-id');
    const direct = projectTraceForUpload(original, 'metadata');
    const cached = projectTraceForUpload(projectTraceForLocalIndex(original), 'metadata');

    expect(cached.sourceExternalIdHash).toBe(direct.sourceExternalIdHash);
    expect(cached.sourceExternalIdHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('preserves opaque relationship links and counts connected work across repositories', () => {
    const source = trace('autohand', 'source', {
      project: { path: '/Users/private/work/source-repository' },
    });
    const child = trace('autohand', 'child', {
      project: { path: '/Users/private/work/child-repository' },
      relationships: [{ type: 'worktree', traceId: source.id }],
    });
    const indexedSource = projectTraceForLocalIndex(source);
    const indexedChild = projectTraceForLocalIndex(child);

    expect(indexedChild.relationships).toEqual([{ type: 'worktree', traceId: source.id }]);

    const result = deriveWorkMap([indexedSource, indexedChild], {
      since: '30d',
      now: new Date('2026-09-18T00:00:00.000Z'),
      coverage: [],
    });

    expect(result.repositories).toEqual({ observed: 2, multiRepositorySessions: 2 });
    expect(result.relationships.worktree).toBe(1);
  });
});
