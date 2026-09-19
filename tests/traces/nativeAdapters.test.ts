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
import type { TraceHarness } from '../../src/traces/model.js';
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
});
