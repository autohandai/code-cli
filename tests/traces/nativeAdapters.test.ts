import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTraceSourceRegistry,
  type TraceSourceRegistryOptions,
} from '../../src/traces/adapters/sourceRegistry.js';
import { createCanonicalTraceId, type TraceHarness } from '../../src/traces/model.js';
import {
  DEFAULT_TRACE_SCAN_LIMITS,
  readBoundedTraceFile,
} from '../../src/traces/adapters/NativeTraceAdapter.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahtraces-adapter-test-'));
  roots.push(root);
  return root;
}

function registryOptions(root: string, harness: TraceHarness): TraceSourceRegistryOptions {
  return {
    homeDirectory: root,
    autohandHome: path.join(root, '.autohand'),
    environment: {},
    platform: process.platform,
    locationOverrides: { [harness]: [root] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('native trace Adapters', () => {
  it('keeps each harness scan within the interactive sidecar memory budget', () => {
    expect(DEFAULT_TRACE_SCAN_LIMITS).toEqual({
      maxFiles: 5_000,
      maxBytesPerFile: 64 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
      maxRecords: 100_000,
    });
  });

  it('rejects a trace source that grows after discovery instead of reading past its budget', async () => {
    const root = await tempRoot();
    const filePath = path.join(root, 'growing.jsonl');
    await fs.writeFile(filePath, '{}');
    const discovered = await fs.lstat(filePath);
    await fs.appendFile(filePath, 'x'.repeat(4_096));

    await expect(readBoundedTraceFile(filePath, {
      size: discovered.size,
      mtimeMs: discovered.mtimeMs,
      dev: discovered.dev,
      ino: discovered.ino,
    }, 1_024)).rejects.toThrow('changed while scanning');
  });

  it('parses the Autohand metadata and conversation pair without duplicating the session', async () => {
    const root = await tempRoot();
    const session = path.join(root, 'session-1');
    await fs.ensureDir(session);
    await fs.writeJson(path.join(session, 'metadata.json'), {
      sessionId: 'session-1',
      projectPath: '/workspace/autohand',
      projectName: 'autohand',
      model: 'gpt-6',
      provider: 'openai',
      status: 'completed',
      createdAt: '2026-09-18T00:00:00.000Z',
      closedAt: '2026-09-18T00:01:00.000Z',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, tokenUsageStatus: 'actual' },
    });
    await fs.writeFile(path.join(session, 'conversation.jsonl'), [
      JSON.stringify({ role: 'user', content: 'inspect this', timestamp: '2026-09-18T00:00:01.000Z' }),
      JSON.stringify({ role: 'assistant', content: 'done', timestamp: '2026-09-18T00:00:02.000Z' }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'autohand')).get('autohand')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'autohand', externalId: 'session-1' },
      model: 'gpt-6',
      provider: 'openai',
      usage: { input: 10, output: 4, total: 14, provenance: 'actual' },
      messages: [{ role: 'user' }, { role: 'assistant' }],
    });
  });

  it('links an Autohand fork to its source session with canonical trace identities', async () => {
    const root = await tempRoot();
    for (const sessionId of ['source-session', 'fork-session']) {
      const session = path.join(root, sessionId);
      await fs.ensureDir(session);
      await fs.writeJson(path.join(session, 'metadata.json'), {
        sessionId,
        status: 'completed',
        ...(sessionId === 'fork-session'
          ? { branch: { type: 'fork', sourceSessionId: 'source-session' } }
          : {}),
      });
      await fs.writeFile(path.join(session, 'conversation.jsonl'), JSON.stringify({
        role: 'user', content: sessionId,
      }));
    }
    const adapter = createTraceSourceRegistry(registryOptions(root, 'autohand')).get('autohand')!;

    const result = await adapter.scan();

    const source = result.traces.find((entry) => entry.source.externalId === 'source-session');
    const fork = result.traces.find((entry) => entry.source.externalId === 'fork-session');
    expect(source).toBeDefined();
    expect(fork?.relationships).toEqual([{ type: 'fork', traceId: source?.id }]);
  });

  it('retains Claude Code typed text, reasoning, tool call, and tool result parts', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'claude.jsonl'), [
      JSON.stringify({
        type: 'user', sessionId: 'claude-1', cwd: '/workspace/claude', timestamp: '2026-09-18T00:00:00.000Z',
        message: { role: 'user', content: 'run tests' },
      }),
      JSON.stringify({
        type: 'assistant', sessionId: 'claude-1', timestamp: '2026-09-18T00:00:01.000Z',
        message: {
          role: 'assistant', model: 'claude-opus-4-1',
          usage: { input_tokens: 12, output_tokens: 7 },
          content: [
            { type: 'thinking', thinking: 'check suite' },
            { type: 'text', text: 'Running tests' },
            { type: 'tool_use', id: 'call-1', name: 'run_command', input: { command: 'bun test' } },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'pass' },
          ],
        },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'claude-code')).get('claude-code')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].messages[1].parts.map((part) => part.type)).toEqual([
      'reasoning', 'text', 'tool_call', 'tool_result',
    ]);
    expect(result.traces[0]).toMatchObject({ model: 'claude-opus-4-1', usage: { provenance: 'actual' } });
  });

  it('sums per-message token usage while preferring an explicit session aggregate', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'claude.jsonl'), [
      JSON.stringify({
        type: 'assistant', sessionId: 'claude-usage',
        message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 4 }, content: 'one' },
      }),
      JSON.stringify({
        type: 'assistant', sessionId: 'claude-usage',
        message: { role: 'assistant', usage: { input_tokens: 12, output_tokens: 5 }, content: 'two' },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'claude-code')).get('claude-code')!;

    const summed = await adapter.scan();

    expect(summed.traces[0].usage).toMatchObject({ input: 22, output: 9, total: 31, provenance: 'actual' });

    await fs.writeFile(path.join(root, 'claude.jsonl'), [
      JSON.stringify({ sessionId: 'claude-usage', usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 } }),
      JSON.stringify({
        type: 'assistant', sessionId: 'claude-usage',
        message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 4 }, content: 'one' },
      }),
      JSON.stringify({
        type: 'assistant', sessionId: 'claude-usage',
        message: { role: 'assistant', usage: { input_tokens: 12, output_tokens: 5 }, content: 'two' },
      }),
    ].join('\n'));

    const aggregated = await adapter.scan();

    expect(aggregated.traces[0].usage).toMatchObject({ input: 20, output: 8, total: 28, provenance: 'actual' });
  });

  it('does not mistake tool arguments or results for token accounting', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'claude.jsonl'), JSON.stringify({
      type: 'assistant', sessionId: 'tool-numbers',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-1', name: 'inspect', input: { input: 900 } },
          { type: 'tool_result', tool_use_id: 'call-1', content: { output: 700 } },
        ],
      },
    }));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'claude-code')).get('claude-code')!;

    const result = await adapter.scan();

    expect(result.traces[0].usage).toEqual({ provenance: 'unavailable' });
    expect(result.traces[0].messages[0].usage).toEqual({ provenance: 'unavailable' });
  });

  it('parses Codex response items and token-count events', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'codex.jsonl'), [
      JSON.stringify({
        timestamp: '2026-09-18T00:00:00.000Z', type: 'session_meta',
        payload: { id: 'codex-1', cwd: '/workspace/codex', model_provider: 'openai' },
      }),
      JSON.stringify({
        timestamp: '2026-09-18T00:00:01.000Z', type: 'turn_context',
        payload: { model: 'gpt-6', effort: 'xhigh' },
      }),
      JSON.stringify({
        timestamp: '2026-09-18T00:00:02.000Z', type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inspect' }] },
      }),
      JSON.stringify({
        timestamp: '2026-09-18T00:00:02.500Z', type: 'response_item',
        payload: {
          type: 'function_call', call_id: 'call-test', name: 'exec_command',
          arguments: JSON.stringify({ command: 'bun test' }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-18T00:00:02.750Z', type: 'response_item',
        payload: {
          type: 'function_call_output', call_id: 'call-test',
          output: JSON.stringify({ output: '12 tests passed', exit_code: 0 }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-18T00:00:03.000Z', type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20, output_tokens: 5, reasoning_output_tokens: 2 } } },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'codex')).get('codex')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'codex-1' },
      model: 'gpt-6',
      provider: 'openai',
      reasoningEffort: 'xhigh',
      usage: { input: 20, output: 5, reasoning: 2, provenance: 'actual' },
      outcome: { state: 'verified', facts: ['tests_passed'] },
    });
    expect(result.traces[0].messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_call', name: 'exec_command', callId: 'call-test',
        arguments: { command: 'bun test' },
      }),
      expect.objectContaining({
        type: 'tool_result', callId: 'call-test', exitCode: 0,
      }),
    ]));
  });

  it.each<TraceHarness>([
    'pi', 'amp', 'copilot', 'cline', 'openclaw', 'droid', 'grok', 'kimi',
    'antigravity', 'prime-agent', 'fx',
  ])('normalizes JSON-family sessions from %s', async (harness) => {
    const root = await tempRoot();
    const record = {
      sessionId: `${harness}-1`,
      model: 'model-1',
      provider: 'provider-1',
      reasoningEffort: 'high',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: '2026-09-18T00:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: 'world', timestamp: '2026-09-18T00:00:01.000Z' },
      ],
      usage: { input_tokens: 3, output_tokens: 2 },
    };
    const adapter = createTraceSourceRegistry(registryOptions(root, harness)).get(harness)!;
    const extension = adapter.formats.includes('json') ? 'json' : 'jsonl';
    await fs.writeFile(path.join(root, `session.${extension}`), JSON.stringify(record));

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness, externalId: `${harness}-1` },
      model: 'model-1',
      provider: 'provider-1',
      reasoningEffort: 'high',
      usage: { input: 3, output: 2, provenance: 'actual' },
    });
    expect(result.traces[0].messages).toHaveLength(2);
  });

  it.each<TraceHarness>(['cursor', 'opencode', 'opencode2', 'hermes'])
  ('reads SQLite message stores from %s in read-only mode', async (harness) => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'sessions.db');
    await fs.writeFile(dbPath, 'sqlite fixture');
    const close = vi.fn();
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn(() => sql.includes('sqlite_master')
        ? [{ name: 'messages' }]
        : [{
          session_id: `${harness}-sqlite-1`,
          id: 'm1',
          role: 'user',
          content: 'hello sqlite',
          model: 'sqlite-model',
          provider: 'sqlite-provider',
          created_at: '2026-09-18T00:00:00.000Z',
        }]),
    }));
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return { prepare, close } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, harness)).get(harness)!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness, externalId: `${harness}-sqlite-1` },
      model: 'sqlite-model',
      provider: 'sqlite-provider',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello sqlite' }] }],
    });
    expect(DatabaseSync).toHaveBeenCalledWith(dbPath, { readOnly: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it('recognizes Cursor state.vscdb as a read-only SQLite source', async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'state.vscdb');
    await fs.writeFile(dbPath, 'sqlite fixture');
    const close = vi.fn();
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn(() => sql.includes('sqlite_master')
        ? [{ name: 'messages' }]
        : [{
          session_id: 'cursor-vscdb-1',
          id: 'm1',
          role: 'user',
          content: 'hello from Cursor',
        }]),
    }));
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return { prepare, close } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'cursor')).get('cursor')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'cursor', externalId: 'cursor-vscdb-1' },
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello from Cursor' }] }],
    });
    expect(DatabaseSync).toHaveBeenCalledWith(dbPath, { readOnly: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it('joins native OpenCode SQLite messages and parts without querying credential tables', async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'opencode.db');
    await fs.writeFile(dbPath, 'sqlite fixture');
    const rows: Record<string, Array<Record<string, unknown>>> = {
      session: [{
        id: 'ses_native', parent_id: 'ses_parent', directory: '/workspace/project', version: '1.2.3',
        time_created: 1_779_120_000_000, time_updated: 1_779_120_003_000,
        model: JSON.stringify({ modelID: 'gpt-6', providerID: 'openai' }),
      }],
      message: [
        { id: 'msg_user', session_id: 'ses_native', time_created: 1_779_120_000_000,
          data: JSON.stringify({ role: 'user', time: { created: 1_779_120_000_000 } }) },
        { id: 'msg_assistant', session_id: 'ses_native', time_created: 1_779_120_001_000,
          data: JSON.stringify({ role: 'assistant', modelID: 'gpt-6', providerID: 'openai',
            time: { created: 1_779_120_001_000 },
            tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } } }) },
      ],
      part: [
        { id: 'prt_user', message_id: 'msg_user', session_id: 'ses_native', time_created: 1_779_120_000_000,
          data: JSON.stringify({ type: 'text', text: 'run tests' }) },
        { id: 'prt_reasoning', message_id: 'msg_assistant', session_id: 'ses_native', time_created: 1_779_120_001_000,
          data: JSON.stringify({ type: 'reasoning', text: 'check suite' }) },
        { id: 'prt_tool', message_id: 'msg_assistant', session_id: 'ses_native', time_created: 1_779_120_002_000,
          data: JSON.stringify({ type: 'tool', tool: 'bash', callID: 'call-1',
            state: { status: 'completed', input: { command: 'bun test' }, output: 'passed', metadata: { exitCode: 0 } } }) },
      ],
    };
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn((limit?: number) => {
        if (sql.includes('sqlite_master')) {
          return ['account', 'credential', 'session_share', 'session', 'message', 'part'].map((name) => ({ name }));
        }
        const pragma = /PRAGMA table_info\("([^"]+)"\)/u.exec(sql);
        if (pragma) return Object.keys(rows[pragma[1]]?.[0] ?? {}).map((name) => ({ name }));
        const table = /FROM "([^"]+)"/u.exec(sql)?.[1];
        return rows[table ?? '']?.slice(0, limit) ?? [];
      }),
    }));
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return { prepare, close: vi.fn() } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'opencode')).get('opencode')!;

    const result = await adapter.scan();

    expect(prepare.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/FROM "(?:account|credential|session_share)"/u);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'ses_native' },
      model: 'gpt-6', provider: 'openai',
      usage: { input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1, total: 21, provenance: 'actual' },
      relationships: [{ type: 'parent', traceId: createCanonicalTraceId('opencode', 'ses_parent', dbPath) }],
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'run tests' }] },
        { role: 'assistant', parts: [
          { type: 'reasoning', text: 'check suite' },
          { type: 'tool_call', name: 'bash', callId: 'call-1', arguments: { command: 'bun test' } },
          { type: 'tool_result', name: 'bash', callId: 'call-1', content: 'passed', exitCode: 0 },
        ] },
      ],
    });
  });

  it('reads OpenCode 2 session_message rows without duplicating legacy OpenCode messages', async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'opencode.db');
    await fs.writeFile(dbPath, 'sqlite fixture');
    const rows: Record<string, Array<Record<string, unknown>>> = {
      session: [
        { id: 'ses_v2', directory: '/workspace/project', version: '2.0.0',
          time_created: 1_779_120_000_000, time_updated: 1_779_120_002_000,
          tokens_input: 0, tokens_output: 0, tokens_reasoning: 0,
          tokens_cache_read: 0, tokens_cache_write: 0 },
        { id: 'ses_v1', directory: '/workspace/legacy', version: '1.0.0',
          time_created: 1_779_120_000_000, time_updated: 1_779_120_002_000 },
      ],
      session_message: [
        { id: 'msg_v2_user', session_id: 'ses_v2', type: 'user', seq: 1,
          time_created: 1_779_120_000_000, data: JSON.stringify({ text: 'inspect', time: { created: 1_779_120_000_000 } }) },
        { id: 'msg_v2_assistant', session_id: 'ses_v2', type: 'assistant', seq: 2,
          time_created: 1_779_120_001_000, data: JSON.stringify({
            model: { id: 'gpt-6', providerID: 'openai' },
            tokens: { input: 12, output: 5, reasoning: 2, cache: { read: 3, write: 1 } },
            content: [
              { type: 'text', id: 'txt_1', text: 'done' },
              { type: 'tool', id: 'call-2', name: 'bash', state: {
                status: 'completed', input: { command: 'bun test' }, result: 'passed', content: [], structured: {},
              } },
            ],
            time: { created: 1_779_120_001_000 },
          }) },
      ],
      message: [
        { id: 'msg_legacy', session_id: 'ses_v2', data: JSON.stringify({ role: 'assistant' }) },
        { id: 'msg_v1', session_id: 'ses_v1', data: JSON.stringify({ role: 'user' }) },
      ],
      part: [
        { id: 'prt_legacy', message_id: 'msg_legacy', session_id: 'ses_v2',
          data: JSON.stringify({ type: 'text', text: 'must not duplicate' }) },
        { id: 'prt_v1', message_id: 'msg_v1', session_id: 'ses_v1',
          data: JSON.stringify({ type: 'text', text: 'legacy remains visible' }) },
      ],
    };
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn((limit?: number) => {
        if (sql.includes('sqlite_master')) {
          return ['session', 'session_message', 'message', 'part', 'account'].map((name) => ({ name }));
        }
        const pragma = /PRAGMA table_info\("([^"]+)"\)/u.exec(sql);
        if (pragma) return Object.keys(rows[pragma[1]]?.[0] ?? {}).map((name) => ({ name }));
        const table = /FROM "([^"]+)"/u.exec(sql)?.[1];
        return rows[table ?? '']?.slice(0, limit) ?? [];
      }),
    }));
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return { prepare, close: vi.fn() } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'opencode2')).get('opencode2')!;

    const result = await adapter.scan();

    expect(prepare.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/FROM "(?:message|part|account)"/u);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'opencode2', externalId: 'ses_v2' },
      model: 'gpt-6', provider: 'openai',
      usage: { input: 12, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1, total: 23 },
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'inspect' }] },
        { role: 'assistant', parts: [
          { type: 'text', text: 'done' },
          { type: 'tool_call', name: 'bash', callId: 'call-2', arguments: { command: 'bun test' } },
          { type: 'tool_result', name: 'bash', callId: 'call-2', content: 'passed' },
        ] },
      ],
    });

    const legacyAdapter = createTraceSourceRegistry(registryOptions(root, 'opencode')).get('opencode')!;
    const legacyResult = await legacyAdapter.scan();
    expect(legacyResult.traces.map((trace) => trace.source.externalId)).toEqual(['ses_v1']);
  });

  it('does not attribute legacy-only sessions in a shared database to OpenCode 2', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'opencode.db'), 'sqlite fixture');
    const rows: Record<string, Array<Record<string, unknown>>> = {
      session: [{ id: 'ses_legacy', directory: '/workspace/project', tokens_input: 10 }],
      session_message: [],
      message: [{ id: 'msg_legacy', session_id: 'ses_legacy', data: JSON.stringify({ role: 'user' }) }],
      part: [{ id: 'prt_legacy', message_id: 'msg_legacy', session_id: 'ses_legacy',
        data: JSON.stringify({ type: 'text', text: 'legacy' }) }],
    };
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn((limit?: number) => {
            if (sql.includes('sqlite_master')) return Object.keys(rows).map((name) => ({ name }));
            const pragma = /PRAGMA table_info\("([^"]+)"\)/u.exec(sql);
            if (pragma) return Object.keys(rows[pragma[1]]?.[0] ?? {
              id: '', session_id: '', type: '', data: '',
            }).map((name) => ({ name }));
            const table = /FROM "([^"]+)"/u.exec(sql)?.[1];
            return rows[table ?? '']?.slice(0, limit) ?? [];
          }),
        })),
        close: vi.fn(),
      } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'opencode2')).get('opencode2')!;

    const result = await adapter.scan();

    expect(result.traces).toEqual([]);
  });

  it('keeps decoded SQLite records within the cumulative scan record budget', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'one.db'), 'sqlite fixture one');
    await fs.writeFile(path.join(root, 'two.db'), 'sqlite fixture two');
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase(databasePath) {
      const source = path.basename(String(databasePath), '.db');
      return {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => sql.includes('sqlite_master')
            ? [{ name: 'messages' }]
            : [{
              session_id: `${source}-base`,
              content: JSON.stringify([{ session_id: `${source}-nested`, role: 'user', content: source }]),
            }]),
        })),
        close: vi.fn(),
      } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'cursor')).get('cursor')!;

    const result = await adapter.scan({ maxRecords: 3 });

    expect(result.traces).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('decompresses DeepSeek Harness JSONL zstd sessions', async () => {
    const root = await tempRoot();
    const content = JSON.stringify({
      sessionId: 'deepseek-1',
      role: 'assistant',
      content: 'compressed trace',
      model: 'deepseek-v3',
      timestamp: '2026-09-18T00:00:00.000Z',
    });
    await fs.writeFile(path.join(root, 'session.jsonl.zst'), zstdCompressSync(Buffer.from(content)));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'deepseek')).get('deepseek')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'deepseek', externalId: 'deepseek-1' },
      model: 'deepseek-v3',
      messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'compressed trace' }] }],
    });
  });

  it('bounds decompressed zstd output instead of allowing a compressed expansion past the file budget', async () => {
    const root = await tempRoot();
    const content = JSON.stringify({
      sessionId: 'deepseek-expansion',
      role: 'assistant',
      content: 'x'.repeat(32_000),
      timestamp: '2026-09-18T00:00:00.000Z',
    });
    await fs.writeFile(path.join(root, 'expansion.jsonl.zst'), zstdCompressSync(Buffer.from(content)));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'deepseek')).get('deepseek')!;

    const result = await adapter.scan({ maxBytesPerFile: 1_024 });

    expect(result.traces).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('bounds cumulative decompressed zstd output across multiple source files', async () => {
    const root = await tempRoot();
    const content = (sessionId: string) => JSON.stringify({
      sessionId,
      role: 'assistant',
      content: 'x'.repeat(700),
      timestamp: '2026-09-18T00:00:00.000Z',
    });
    await fs.writeFile(path.join(root, 'one.jsonl.zst'), zstdCompressSync(Buffer.from(content('one'))));
    await fs.writeFile(path.join(root, 'two.jsonl.zst'), zstdCompressSync(Buffer.from(content('two'))));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'deepseek')).get('deepseek')!;

    const result = await adapter.scan({ maxBytesPerFile: 1_024, maxTotalBytes: 1_100 });

    expect(result.traces).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('does not infer completion from the timestamp of an otherwise statusless message', async () => {
    const root = await tempRoot();
    await fs.writeJson(path.join(root, 'active.json'), {
      sessionId: 'statusless-session',
      role: 'assistant',
      content: 'still working',
      timestamp: '2026-09-18T00:00:00.000Z',
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'pi')).get('pi')!;

    const result = await adapter.scan();

    expect(result.traces[0]).toMatchObject({
      status: 'unknown',
      outcome: { state: 'unknown', confidence: 'low' },
    });
  });

  it('skips unchanged native files using opaque source fingerprints', async () => {
    const root = await tempRoot();
    await fs.writeJson(path.join(root, 'session.json'), {
      sessionId: 'pi-one',
      role: 'user',
      content: 'hello',
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'pi')).get('pi')!;

    const first = await adapter.scan();
    const source = first.sourceFiles[0];
    const second = await adapter.scan({
      knownFingerprints: { [source.key]: source.fingerprint },
    });

    expect(first.traces).toHaveLength(1);
    expect(source.key).toMatch(/^src_[a-f0-9]{32}$/);
    expect(source.key).not.toContain(root);
    expect(second).toMatchObject({ traces: [], bytesRead: 0, filesScanned: 0 });
    expect(second.sourceFiles).toEqual([{ ...source, changed: false, traceIds: [] }]);
  });

  it('rescans a SQLite source when its WAL changes without a main-database update', async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'sessions.db');
    await fs.writeFile(dbPath, 'sqlite fixture');
    await fs.writeFile(`${dbPath}-wal`, 'first transaction');
    vi.mocked(DatabaseSync).mockImplementation(function MockDatabase() {
      return {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => sql.includes('sqlite_master')
            ? [{ name: 'messages' }]
            : [{ session_id: 'wal-session', role: 'user', content: 'hello' }]),
        })),
        close: vi.fn(),
      } as unknown as DatabaseSync;
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'cursor')).get('cursor')!;

    const first = await adapter.scan();
    await fs.appendFile(`${dbPath}-wal`, 'second transaction');
    const second = await adapter.scan({
      knownFingerprints: { [first.sourceFiles[0].key]: first.sourceFiles[0].fingerprint },
    });

    expect(second.sourceFiles[0].changed).toBe(true);
    expect(second.filesScanned).toBe(1);
    expect(second.traces).toHaveLength(1);
  });

  it('counts SQLite WAL bytes against the scan budget and rejects WAL symlinks', async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, 'sessions.db');
    const walPath = `${dbPath}-wal`;
    await fs.writeFile(dbPath, 'sqlite fixture');
    await fs.writeFile(walPath, 'x'.repeat(2_048));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'cursor')).get('cursor')!;

    const oversized = await adapter.scan({ maxTotalBytes: 1_024 });
    expect(oversized).toMatchObject({ filesScanned: 0, bytesRead: 0, truncated: true });

    await fs.remove(walPath);
    const target = path.join(root, 'unrelated.txt');
    await fs.writeFile(target, 'not a WAL');
    await fs.symlink(target, walPath);
    const linked = await adapter.scan();
    expect(linked).toMatchObject({ filesScanned: 0, truncated: true });
    expect(linked.warnings).toContain('Skipped unsafe SQLite WAL for sessions.db.');
  });
});
