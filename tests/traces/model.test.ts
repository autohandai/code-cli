import { describe, expect, it } from 'vitest';
import {
  TRACE_SCHEMA_VERSION,
  createCanonicalTraceId,
  normalizedTraceSchema,
  projectTraceForUpload,
} from '../../src/traces/model.js';

describe('canonical trace model', () => {
  const trace = normalizedTraceSchema.parse({
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: 'trace_01',
    source: {
      harness: 'codex',
      externalId: 'external-session',
      recordPath: '/Users/alice/private/project/session.jsonl',
      fingerprint: 'sha256:fixture',
    },
    agent: { name: 'Codex', version: '1.2.3' },
    project: {
      name: 'private-project',
      path: '/Users/alice/private/project',
      gitRemote: 'https://token@example.test/private/repo.git',
    },
    startedAt: '2026-09-18T00:00:00.000Z',
    endedAt: '2026-09-18T00:01:00.000Z',
    status: 'completed',
    model: 'gpt-6',
    provider: 'openai',
    reasoningEffort: 'high',
    usage: {
      input: 100,
      output: 20,
      reasoning: 5,
      cacheRead: 10,
      total: 135,
      provenance: 'actual',
    },
    relationships: [],
    messages: [{
      id: 'message_01',
      role: 'user',
      order: 0,
      usage: { provenance: 'unavailable' },
      parts: [{ type: 'text', text: 'secret prompt sk-test-secret' }],
    }],
    outcome: {
      state: 'verified',
      facts: ['tests_passed'],
      confidence: 'high',
    },
    provenance: {
      adapterVersion: 1,
      parsedAt: '2026-09-18T00:02:00.000Z',
      completeness: 'complete',
      warnings: [],
    },
  });

  it('uses deterministic opaque IDs that do not expose paths or source IDs', () => {
    const first = createCanonicalTraceId('codex', 'external-session', '/Users/alice/private/project/session.jsonl');
    const second = createCanonicalTraceId('codex', 'external-session', '/Users/alice/private/project/session.jsonl');

    expect(first).toBe(second);
    expect(first).toMatch(/^tr_[a-f0-9]{32}$/);
    expect(first).not.toContain('alice');
    expect(first).not.toContain('external-session');
  });

  it('projects metadata uploads without message content, absolute paths, or remotes', () => {
    const upload = projectTraceForUpload(trace, 'metadata');
    const serialized = JSON.stringify(upload);

    expect(upload.contentMode).toBe('metadata');
    expect(upload).not.toHaveProperty('messages');
    expect(serialized).not.toContain('secret prompt');
    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('token@example');
    expect(upload).toMatchObject({
      harness: 'codex',
      model: 'gpt-6',
      provider: 'openai',
      reasoningEffort: 'high',
      usage: { input: 100, output: 20, reasoning: 5, provenance: 'actual' },
    });
  });

  it('redacts and bounds externally supplied metadata before upload', () => {
    const upload = projectTraceForUpload(normalizedTraceSchema.parse({
      ...trace,
      agent: { name: 'Codex', version: `v-${'x'.repeat(200)}` },
      model: `local:/Users/alice/models/sk-test-secret-${'m'.repeat(300)}`,
      provider: `https://user:password@example.test/${'p'.repeat(200)}`,
      reasoningEffort: 'r'.repeat(100),
    }), 'metadata');
    const serialized = JSON.stringify(upload);

    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('sk-test-secret');
    expect(upload.agentVersion!.length).toBeLessThanOrEqual(100);
    expect(upload.model!.length).toBeLessThanOrEqual(200);
    expect(upload.provider!.length).toBeLessThanOrEqual(100);
    expect(upload.reasoningEffort!.length).toBeLessThanOrEqual(64);
  });

  it('includes structured messages only for explicit full-content uploads and redacts secrets', () => {
    const upload = projectTraceForUpload(trace, 'full');
    const serialized = JSON.stringify(upload);

    expect(upload.contentMode).toBe('full');
    expect(upload.messages).toHaveLength(1);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('sk-test-secret');
    expect(serialized).not.toContain('/Users/alice');
  });

  it('redacts secret and local-path material from structured object keys', () => {
    const upload = projectTraceForUpload(normalizedTraceSchema.parse({
      ...trace,
      messages: [{
        id: 'message-object-key',
        role: 'assistant',
        order: 0,
        usage: { provenance: 'unavailable' },
        parts: [{
          type: 'tool_call',
          name: 'run_command',
          arguments: {
            '/Users/alice/private/sk-test-secret': 'value',
            nested: { 'github_pat_SECRET': true },
          },
        }],
      }],
    }), 'full');
    const serialized = JSON.stringify(upload);

    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('sk-test-secret');
    expect(serialized).not.toContain('github_pat_SECRET');
  });

  it('bounds the final serialized full-content projection below the wire envelope limit', () => {
    const controlHeavy = normalizedTraceSchema.parse({
      ...trace,
      messages: Array.from({ length: 100 }, (_, messageIndex) => ({
        id: `control-heavy-${messageIndex}`,
        role: 'assistant',
        order: messageIndex,
        usage: { provenance: 'unavailable' },
        parts: Array.from({ length: 100 }, () => ({ type: 'text', text: '\0'.repeat(200) })),
      })),
    });

    const upload = projectTraceForUpload(controlHeavy, 'full');

    expect(upload.contentTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(upload))).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it('bounds full-content projections and removes source-native message identifiers', () => {
    const oversized = normalizedTraceSchema.parse({
      ...trace,
      messages: Array.from({ length: 600 }, (_, index) => ({
        id: `native-message-${index}`,
        sourceKey: `provider-secret-${index}`,
        role: 'assistant',
        order: index,
        usage: { provenance: 'unavailable' },
        parts: [{
          type: 'tool_call',
          name: 'run_command',
          arguments: {
            password: 'super-secret-password',
            output: 'x'.repeat(32_000),
          },
        }],
      })),
    });

    const upload = projectTraceForUpload(oversized, 'full');
    const serialized = JSON.stringify(upload);

    expect(upload.contentTruncated).toBe(true);
    expect(upload.messages!.length).toBeLessThanOrEqual(500);
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('super-secret-password');
    expect(Buffer.byteLength(serialized)).toBeLessThan(2 * 1024 * 1024);
  });

  it('bounds nested identifiers and relationship arrays to the cloud schema', () => {
    const oversized = normalizedTraceSchema.parse({
      ...trace,
      relationships: Array.from({ length: 1_005 }, (_, index) => ({
        type: 'child',
        traceId: `tr_${String(index).padStart(32, '0')}`,
      })),
      outcome: {
        state: 'verified',
        facts: Array.from({ length: 40 }, () => 'tests_passed'),
        confidence: 'high',
      },
      messages: [{
        id: 'native-message',
        role: 'assistant',
        order: 0,
        model: 'm'.repeat(400),
        usage: { provenance: 'unavailable' },
        parts: [{
          type: 'tool_call',
          name: 'tool'.repeat(100),
          callId: 'call'.repeat(100),
          arguments: { apiKey: 'sk-secret-value' },
        }],
      }],
    });

    const upload = projectTraceForUpload(oversized, 'full');
    const part = upload.messages![0]!.parts[0]!;

    expect(upload.relationships).toHaveLength(1_000);
    expect(upload.outcome?.facts).toHaveLength(32);
    expect(upload.messages![0]!.model).toHaveLength(200);
    expect(part).toMatchObject({ type: 'tool_call' });
    if (part.type !== 'tool_call') throw new Error('expected tool call');
    expect(part.name.length).toBeLessThanOrEqual(128);
    expect(part.callId!.length).toBeLessThanOrEqual(128);
    expect(JSON.stringify(part.arguments)).not.toContain('sk-secret-value');
    expect(upload.contentTruncated).toBe(true);
  });
});
