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

function ampThread(
  id: string,
  messages: unknown[] = [{
    role: 'user',
    messageId: 0,
    content: [{ type: 'text', text: 'native session' }],
    meta: { sentAt: 1_789_689_600_000 },
  }],
): Record<string, unknown> {
  return {
    v: 1,
    id,
    created: 1_789_689_600_000,
    messages,
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

  it.each<{
    harness: TraceHarness;
    decoy: string;
    session: string;
  }>([
    { harness: 'pi', decoy: '.pi/auth.json', session: '.pi/agent/sessions/project/session.jsonl' },
    { harness: 'amp', decoy: '.local/share/amp/secrets.json', session: '.local/share/amp/threads/T-native-session.json' },
    { harness: 'copilot', decoy: '.copilot/config.json', session: '.copilot/session-state/session-1/events.jsonl' },
    { harness: 'cline', decoy: '.cline/data/secrets.json', session: '.cline/data/tasks/session-1/ui_messages.json' },
    { harness: 'grok', decoy: '.grok/config.json', session: '.grok/sessions/project/session/summary.json' },
    { harness: 'kimi', decoy: '.kimi-code/migration-report.json', session: '.kimi-code/sessions/wd_project/session/wire.jsonl' },
    { harness: 'openclaw', decoy: '.openclaw/agents/main/auth.jsonl', session: '.openclaw/agents/main/sessions/session.jsonl' },
    {
      harness: 'antigravity',
      decoy: '.gemini/antigravity/conversations/session.jsonl',
      session: '.gemini/antigravity/brain/native-session/.system_generated/logs/transcript.jsonl',
    },
    { harness: 'prime-agent', decoy: '.prime/auth.jsonl', session: '.prime/agent/sessions/session.jsonl' },
  ])('opens only $harness session files, not neighboring app configuration', async ({ harness, decoy, session }) => {
    const root = await tempRoot();
    const decoyPath = path.join(root, decoy);
    const sessionPath = path.join(root, session);
    await fs.ensureDir(path.dirname(decoyPath));
    await fs.ensureDir(path.dirname(sessionPath));
    await fs.writeFile(decoyPath, JSON.stringify({
      sessionId: 'credential-decoy',
      messages: [{ role: 'user', content: 'must not be read' }],
    }));
    await fs.writeFile(sessionPath, JSON.stringify(harness === 'antigravity'
      ? {
          step_index: 1,
          type: 'USER_INPUT',
          created_at: '2026-09-18T00:00:00.000Z',
          content: '<USER_REQUEST>native session</USER_REQUEST>',
        }
      : harness === 'amp'
        ? ampThread('T-native-session')
      : {
          sessionId: 'native-session',
          messages: [{ role: 'user', content: 'native session' }],
        }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get(harness)!;

    const result = await adapter.scan();

    expect(result.traces.map((trace) => trace.source.externalId)).toEqual([
      harness === 'amp' ? 'T-native-session' : 'native-session',
    ]);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.filesScanned).toBe(1);
  });

  it.each([
    'auth.json',
    'auth.backup.json',
    'secrets.json',
    'credentials.json',
    'settings.json',
    'tokens.json',
    'oauth.json',
    'account.json',
    'api_keys.json',
    'identity.json',
  ])('does not read %s inside an explicitly selected session root', async (decoyName) => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, decoyName), JSON.stringify({
      sessionId: 'credential-decoy',
      messages: [{ role: 'user', content: 'must not be read' }],
    }));
    await fs.writeFile(path.join(root, 'T-native-session.json'), JSON.stringify(ampThread('T-native-session')));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'amp')).get('amp')!;

    const result = await adapter.scan();

    expect(result.traces.map((trace) => trace.source.externalId)).toEqual(['T-native-session']);
    expect(result.sourceFiles).toHaveLength(1);
  });

  it.each(['auth', 'secrets', 'credentials', 'oauth', 'api_keys'])
  ('does not descend into %s directories inside a session root', async (decoyDirectory) => {
    const root = await tempRoot();
    await fs.ensureDir(path.join(root, decoyDirectory));
    await fs.writeFile(path.join(root, decoyDirectory, 'session.jsonl'), JSON.stringify({
      sessionId: 'credential-decoy',
      messages: [{ role: 'user', content: 'must not be read' }],
    }));
    await fs.writeFile(path.join(root, 'T-native-session.json'), JSON.stringify(ampThread('T-native-session')));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'amp')).get('amp')!;

    const result = await adapter.scan();

    expect(result.traces.map((trace) => trace.source.externalId)).toEqual(['T-native-session']);
    expect(result.sourceFiles).toHaveLength(1);
  });

  it.each<TraceHarness>(['cursor', 'copilot'])('ignores non-chat JSON in %s VS Code workspace storage', async (harness) => {
    const root = await tempRoot();
    const app = harness === 'cursor' ? 'Cursor' : 'Code';
    const storage = path.join(root, 'Library', 'Application Support', app, 'User', 'workspaceStorage', 'workspace-hash');
    await fs.ensureDir(path.join(storage, 'chatSessions'));
    await fs.writeFile(path.join(storage, 'config.json'), JSON.stringify({
      sessionId: 'credential-decoy',
      messages: [{ role: 'user', content: 'must not be read' }],
    }));
    await fs.writeFile(path.join(storage, 'chatSessions', 'session.json'), JSON.stringify({
      sessionId: 'native-session',
      messages: [{ role: 'user', content: 'native session' }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: 'darwin',
    }).get(harness)!;

    const result = await adapter.scan();

    expect(result.traces.map((trace) => trace.source.externalId)).toEqual(['native-session']);
    expect(result.sourceFiles).toHaveLength(1);
  });

  it('does not treat Cursor project markers as conversation history', async () => {
    const root = await tempRoot();
    const project = path.join(root, '.cursor', 'projects', 'project-hash');
    await fs.ensureDir(project);
    await fs.writeFile(path.join(project, 'project_settings.json'), JSON.stringify({
      sessionId: 'credential-decoy',
      messages: [{ role: 'user', content: 'must not be read' }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: 'darwin',
    }).get('cursor')!;

    const result = await adapter.scan();

    expect(result.traces).toEqual([]);
    expect(result.sourceFiles).toEqual([]);
  });

  it('does not open arbitrary Hermes databases next to the session store', async () => {
    const root = await tempRoot();
    const hermes = path.join(root, '.hermes');
    await fs.ensureDir(hermes);
    await fs.writeFile(path.join(hermes, 'auth.db'), 'not a session database');
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('hermes')!;

    const result = await adapter.scan();

    expect(result.sourceFiles).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('normalizes native Amp thread documents with metadata, tools, status, and cache-aware usage', async () => {
    const root = await tempRoot();
    const threadId = 'T-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
    const threadPath = path.join(root, `${threadId}.json`);
    await fs.writeFile(threadPath, JSON.stringify({
      v: 42,
      id: threadId,
      created: 1_768_178_184_664,
      title: 'Fix the off-by-one',
      agentMode: 'smart',
      env: {
        initial: {
          trees: [{
            uri: 'file:///Users/dev/proj%20x',
            displayName: 'proj x',
            repository: {
              ref: 'refs/heads/main',
              sha: 'abc123',
              url: 'https://example.com/r.git',
              type: 'git',
            },
          }],
          platform: { client: 'CLI', clientVersion: '0.0.1768178000-gaaaaaa' },
          tags: ['model:claude-opus-4-5-20251101'],
        },
      },
      messages: [
        {
          role: 'user', messageId: 0,
          content: [{ type: 'text', text: 'fix the loop bound' }],
          meta: { sentAt: 1_768_178_271_390 },
        },
        {
          role: 'assistant', messageId: 1,
          content: [
            { type: 'thinking', thinking: 'the bound is off', signature: 'private-signature' },
            {
              type: 'tool_use', complete: true, id: 'toolu_01', name: 'Bash',
              input: { cmd: "grep -n 'i <= n' src/a.rs", cwd: '/Users/dev/proj x' },
            },
          ],
          state: { type: 'complete', stopReason: 'tool_use' },
          usage: {
            model: 'claude-opus-4-5-20251101',
            inputTokens: 12,
            outputTokens: 80,
            cacheCreationInputTokens: 900,
            cacheReadInputTokens: 3_400,
            totalInputTokens: 4_312,
            maxInputTokens: 168_000,
            timestamp: '2026-01-12T00:37:55.000Z',
          },
        },
        {
          role: 'user', messageId: 2,
          content: [{
            type: 'tool_result', toolUseID: 'toolu_01',
            run: { status: 'done', result: { output: '7: i <= n\n', exitCode: 0 } },
          }],
        },
        {
          role: 'assistant', messageId: 3,
          content: [{ type: 'text', text: 'Fixed the bound.' }],
          state: { type: 'complete', stopReason: 'end_turn' },
          usage: {
            model: 'claude-opus-4-5-20251101',
            inputTokens: 6,
            outputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 4_310,
            totalInputTokens: 4_316,
            maxInputTokens: 168_000,
            timestamp: '2026-01-12T00:38:12.000Z',
          },
        },
        { role: 'supervisor', note: 'private bookkeeping must not become content' },
      ],
    }));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'amp')).get('amp')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ filesScanned: 1, truncated: true });
    expect(result.warnings).toEqual([
      expect.stringContaining('unsupported message role "supervisor"'),
    ]);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      id: createCanonicalTraceId('amp', threadId, 'native-session-id'),
      source: { harness: 'amp', externalId: threadId, recordPath: threadPath },
      agent: { name: 'Amp', version: '0.0.1768178000-gaaaaaa' },
      project: {
        name: 'proj x',
        path: '/Users/dev/proj x',
        gitRemote: 'https://example.com/r.git',
        gitBranch: 'main',
        gitRef: 'abc123',
      },
      startedAt: '2026-01-12T00:36:24.664Z',
      endedAt: '2026-01-12T00:38:12.000Z',
      status: 'completed',
      model: 'claude-opus-4-5-20251101',
      contextWindow: 168_000,
      usage: {
        input: 18,
        output: 100,
        cacheRead: 7_710,
        cacheWrite: 900,
        total: 8_728,
        provenance: 'actual',
      },
      provenance: { completeness: 'partial' },
    });
    expect(result.traces[0].messages).toMatchObject([
      {
        sourceKey: '0', role: 'user', timestamp: '2026-01-12T00:37:51.390Z',
        parts: [{ type: 'text', text: 'fix the loop bound' }],
      },
      {
        sourceKey: '1', role: 'assistant', timestamp: '2026-01-12T00:37:55.000Z',
        model: 'claude-opus-4-5-20251101',
        usage: {
          input: 12, output: 80, cacheRead: 3_400, cacheWrite: 900,
          total: 4_392, provenance: 'actual',
        },
        parts: [
          { type: 'reasoning', text: 'the bound is off' },
          {
            type: 'tool_call', name: 'Bash', callId: 'toolu_01',
            arguments: { cmd: "grep -n 'i <= n' src/a.rs", cwd: '/Users/dev/proj x' },
          },
        ],
      },
      {
        sourceKey: '2', role: 'tool', timestamp: '2026-01-12T00:37:55.000Z',
        parts: [{
          type: 'tool_result', name: 'Bash', callId: 'toolu_01',
          content: { output: '7: i <= n\n', exitCode: 0 }, exitCode: 0,
        }],
      },
      {
        sourceKey: '3', role: 'assistant', timestamp: '2026-01-12T00:38:12.000Z',
        model: 'claude-opus-4-5-20251101',
        parts: [{ type: 'text', text: 'Fixed the bound.' }],
      },
    ]);
    expect(JSON.stringify(result.traces[0])).not.toContain('private bookkeeping');
    expect(JSON.stringify(result.traces[0])).not.toContain('private-signature');
  });

  it('limits Amp discovery to flat thread JSON and deduplicates copied native identities', async () => {
    const root = await tempRoot();
    const threads = path.join(root, '.local', 'share', 'amp', 'threads');
    const nativeId = 'T-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0002';
    await fs.ensureDir(path.join(threads, 'nested'));
    await fs.writeFile(path.join(root, '.local', 'share', 'amp', 'history.jsonl'), JSON.stringify({
      sessionId: 'prompt-history-decoy', role: 'user', content: 'must not be read',
    }));
    await fs.writeFile(path.join(threads, 'nested', 'T-nested-decoy.json'), JSON.stringify(
      ampThread('T-nested-decoy'),
    ));
    await fs.writeFile(path.join(threads, 'settings.json'), JSON.stringify(ampThread('T-settings-decoy')));
    await fs.writeFile(path.join(threads, 'T-copy-a.json'), JSON.stringify(ampThread(nativeId)));
    const longerCopyPath = path.join(threads, 'T-copy-b.json');
    await fs.writeFile(longerCopyPath, JSON.stringify(ampThread(nativeId, [
      {
        role: 'user', messageId: 0,
        content: [{ type: 'text', text: 'First copy.' }],
        meta: { sentAt: 1_789_689_600_000 },
      },
      {
        role: 'assistant', messageId: 1,
        content: [{ type: 'text', text: 'Longer copy wins.' }],
        state: { type: 'complete', stopReason: 'end_turn' },
        usage: { inputTokens: 3, outputTokens: 2, timestamp: '2026-09-18T00:00:01.000Z' },
      },
    ])));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('amp')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ filesScanned: 2, truncated: false, warnings: [] });
    expect(result.sourceFiles).toHaveLength(2);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      id: createCanonicalTraceId('amp', nativeId, 'native-session-id'),
      source: { externalId: nativeId, recordPath: longerCopyPath },
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'First copy.' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Longer copy wins.' }] },
      ],
    });
    expect(new Set(result.sourceFiles.flatMap((source) => source.traceIds))).toEqual(
      new Set([result.traces[0].id]),
    );
  });

  it('links Amp subthreads and preserves cancelled, rejected, and failed tool outcomes', async () => {
    const root = await tempRoot();
    const parentId = 'T-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0010';
    const childId = 'T-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0011';
    const parent = {
      ...ampThread(parentId, [
        {
          role: 'assistant', messageId: 0,
          content: [
            { type: 'tool_use', id: 'tool-error', name: 'painter', input: { prompt: 'draw' } },
            { type: 'tool_use', id: 'tool-rejected', name: 'shell_command', input: { command: 'deploy' } },
          ],
          state: { type: 'complete', stopReason: 'tool_use' },
          usage: { inputTokens: 1, outputTokens: 2, timestamp: '2026-09-18T00:00:01.000Z' },
        },
        {
          role: 'user', messageId: 1,
          content: [
            {
              type: 'tool_result', toolUseID: 'tool-error',
              run: { status: 'error', error: { message: 'render failed' } },
            },
            {
              type: 'tool_result', toolUseID: 'tool-rejected',
              run: { status: 'rejected-by-user', reason: 'not allowed' },
            },
          ],
        },
        {
          role: 'assistant', messageId: 2,
          content: [{ type: 'text', text: 'Waiting.' }],
          state: { type: 'streaming' },
          usage: { inputTokens: 3, outputTokens: 1, timestamp: '2026-09-18T00:00:02.000Z' },
        },
      ]),
      subThreads: [{ id: childId }],
    };
    const child = {
      ...ampThread(childId, [{
        role: 'assistant', messageId: 0,
        content: [{ type: 'text', text: 'Stopped.' }],
        state: { type: 'cancelled' },
        usage: { inputTokens: 2, outputTokens: 1, timestamp: '2026-09-18T00:00:03.000Z' },
      }]),
      parentThreadID: parentId,
    };
    await fs.writeFile(path.join(root, `${parentId}.json`), JSON.stringify(parent));
    await fs.writeFile(path.join(root, `${childId}.json`), JSON.stringify(child));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'amp')).get('amp')!;

    const result = await adapter.scan();

    const parentTrace = result.traces.find((trace) => trace.source.externalId === parentId)!;
    const childTrace = result.traces.find((trace) => trace.source.externalId === childId)!;
    expect(parentTrace.status).toBe('active');
    expect(parentTrace.relationships).toContainEqual({ type: 'child', traceId: childTrace.id });
    expect(childTrace.status).toBe('cancelled');
    expect(childTrace.relationships).toContainEqual({ type: 'parent', traceId: parentTrace.id });
    expect(parentTrace.messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_result', name: 'painter', callId: 'tool-error',
        content: 'render failed', isError: true,
      }),
      expect.objectContaining({
        type: 'tool_result', name: 'shell_command', callId: 'tool-rejected',
        content: 'not allowed', isError: true,
      }),
    ]));
  });

  it('reads Cline SDK v1 session messages with per-message model, timestamp, and actual usage', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.cline', 'data', 'sessions', 'session-native');
    await fs.ensureDir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, 'session-native.messages.json'), JSON.stringify({
      version: 1,
      sessionId: 'session-native',
      agent: 'lead',
      updated_at: '2026-09-21T00:00:04.000Z',
      system_prompt: 'private setup not part of the work map',
      messages: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Summarize the project' }] },
        {
          id: 'm2', role: 'assistant', ts: Date.parse('2026-09-21T00:00:01.000Z'),
          modelInfo: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
          content: [{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'README.md' } }],
        },
        { id: 'm3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'Project' }] },
        {
          id: 'm4', role: 'assistant', ts: Date.parse('2026-09-21T00:00:02.000Z'),
          modelInfo: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
          metrics: { inputTokens: 21, outputTokens: 8, cacheReadTokens: 3, cacheWriteTokens: 1, cost: 0.13 },
          content: [{ type: 'text', text: 'It is a project.' }],
        },
        {
          id: 'm5', role: 'assistant', ts: Date.parse('2026-09-21T00:00:03.000Z'),
          modelInfo: { id: 'gpt-6', provider: 'openai' },
          metrics: { inputTokens: 6, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.01 },
          content: [{ type: 'text', text: 'One more detail.' }],
        },
      ],
    }));
    await fs.writeFile(path.join(sessionDirectory, 'other.messages.json'), JSON.stringify({
      version: 1, sessionId: 'credential-decoy', messages: [{ role: 'user', content: 'must not be read' }],
    }));
    await fs.writeFile(path.join(sessionDirectory, 'hooks.jsonl'), JSON.stringify({
      sessionId: 'credential-decoy', messages: [{ role: 'user', content: 'must not be read' }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('cline')!;

    const result = await adapter.scan();

    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'cline', externalId: 'session-native' },
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      usage: { input: 27, output: 12, cacheRead: 3, cacheWrite: 1, provenance: 'actual' },
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Summarize the project' }] },
        { role: 'assistant', model: 'claude-sonnet-4-6', parts: [{ type: 'tool_call', callId: 'call-1' }] },
        { role: 'user', parts: [{ type: 'tool_result', callId: 'call-1' }] },
        { role: 'assistant', model: 'claude-sonnet-4-6', timestamp: '2026-09-21T00:00:02.000Z',
          usage: { input: 21, output: 8, cacheRead: 3, cacheWrite: 1, provenance: 'actual' } },
        { role: 'assistant', model: 'gpt-6', usage: { input: 6, output: 4, provenance: 'actual' } },
      ],
    });
    expect(JSON.stringify(result.traces)).not.toContain('private setup');
  });

  it('joins Cline SDK session manifests with messages and tracks changes to either file', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.cline', 'data', 'sessions', 'session-joined');
    await fs.ensureDir(sessionDirectory);
    const manifestPath = path.join(sessionDirectory, 'session-joined.json');
    const messagesPath = path.join(sessionDirectory, 'session-joined.messages.json');
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 1,
      session_id: 'session-joined',
      source: 'cli',
      status: 'completed',
      started_at: '2026-09-21T00:00:00.000Z',
      ended_at: '2026-09-21T00:01:00.000Z',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      cwd: '/workspace/private-project',
      metadata: { usage: { inputTokens: 30, outputTokens: 10, cacheReadTokens: 5 } },
      messages_path: messagesPath,
    }));
    await fs.writeFile(messagesPath, JSON.stringify({
      version: 1,
      sessionId: 'session-joined',
      origin: { parentThreadId: 'session-parent' },
      messages: [{
        id: 'm1', role: 'assistant', modelInfo: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
        metrics: { inputTokens: 30, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0 },
        content: [{ type: 'text', text: 'Work completed.' }],
      }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('cline')!;

    const first = await adapter.scan();

    expect(first.sourceFiles).toHaveLength(1);
    expect(first.filesScanned).toBe(1);
    expect(first.traces).toHaveLength(1);
    expect(first.traces[0]).toMatchObject({
      source: { harness: 'cline', externalId: 'session-joined' },
      project: { path: '/workspace/private-project' },
      status: 'completed',
      startedAt: '2026-09-21T00:00:00.000Z',
      endedAt: '2026-09-21T00:01:00.000Z',
      usage: { input: 30, output: 10, cacheRead: 5, provenance: 'actual' },
      messages: [{ role: 'assistant', model: 'claude-sonnet-4-6' }],
      relationships: [{ type: 'parent', traceId: createCanonicalTraceId(
        'cline', 'session-parent', path.join(root, '.cline', 'data', 'sessions', 'session-parent', 'session-parent.json'),
      ) }],
    });

    await fs.writeFile(messagesPath, JSON.stringify({
      version: 1, sessionId: 'session-joined',
      messages: [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Work completed with details.' }] }],
    }));
    const second = await adapter.scan({ knownFingerprints: {
      [first.sourceFiles[0].key]: first.sourceFiles[0].fingerprint,
    } });

    expect(second.sourceFiles).toHaveLength(1);
    expect(second.sourceFiles[0].changed).toBe(true);
  });

  it('keeps a Cline manifest without messages as metadata-only coverage', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.cline', 'data', 'sessions', 'session-empty');
    await fs.ensureDir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, 'session-empty.json'), JSON.stringify({
      version: 1,
      session_id: 'session-empty',
      status: 'completed',
      model: 'gpt-6',
      provider: 'openai',
      metadata: { usage: { inputTokens: 0, outputTokens: 0 } },
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('cline')!;

    const result = await adapter.scan();

    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'session-empty' },
      status: 'completed',
      usage: { input: 0, output: 0, provenance: 'actual' },
      messages: [],
      provenance: { completeness: 'metadata_only' },
    });
  });

  it('rejects an unsupported Cline manifest even when its messages file is valid', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.cline', 'data', 'sessions', 'session-future');
    await fs.ensureDir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, 'session-future.json'), JSON.stringify({
      version: 2, session_id: 'session-future', status: 'completed',
    }));
    await fs.writeFile(path.join(sessionDirectory, 'session-future.messages.json'), JSON.stringify({
      version: 1, sessionId: 'session-future',
      messages: [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'do not invent' }] }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('cline')!;

    const result = await adapter.scan();

    expect(result.traces).toEqual([]);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining('Unsupported Cline session manifest')]);
  });

  it('marks an unsupported Cline messages contract as partial instead of inventing usage', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.cline', 'data', 'sessions', 'session-future');
    await fs.ensureDir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, 'session-future.messages.json'), JSON.stringify({
      version: 2,
      sessionId: 'session-future',
      messages: [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'unknown format' }] }],
    }));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('cline')!;

    const result = await adapter.scan();

    expect(result.traces).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining('Unsupported Cline messages contract')]);
  });

  it('counts nested session messages against the bounded scan record budget', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'T-bounded-session.json'), JSON.stringify(ampThread(
      'T-bounded-session',
      Array.from({ length: 10 }, (_, index) => ({
        id: `message-${index}`,
        messageId: index,
        role: 'assistant',
        content: [{ type: 'text', text: `reply ${index}` }],
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    )));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'amp')).get('amp')!;

    const result = await adapter.scan({ maxRecords: 3 });

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].messages).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('treats DSH_HOME as a home directory, not permission to scan its configuration', async () => {
    const root = await tempRoot();
    const dshHome = path.join(root, '.dsh');
    await fs.ensureDir(path.join(dshHome, 'sessions'));
    await fs.writeFile(path.join(dshHome, 'auth.jsonl.zst'), zstdCompressSync(Buffer.from(JSON.stringify({
      sessionId: 'credential-decoy', messages: [{ role: 'user', content: 'must not be read' }],
    }))));
    await fs.writeFile(path.join(dshHome, 'sessions', 'native.jsonl.zst'), zstdCompressSync(Buffer.from(JSON.stringify({
      sessionId: 'native-session', messages: [{ role: 'user', content: 'native session' }],
    }))));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: { DSH_HOME: dshHome },
      platform: process.platform,
    }).get('deepseek')!;

    const result = await adapter.scan();

    expect(result.traces.map((trace) => trace.source.externalId)).toEqual(['native-session']);
    expect(result.sourceFiles).toHaveLength(1);
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

  it('parses native Pi session records with per-message model usage and paired tools', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'pi-session.jsonl'), [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-native-session',
        timestamp: '2026-09-18T00:00:00.000Z',
        cwd: '/workspace/pi',
      }),
      JSON.stringify({
        type: 'model_change',
        id: 'model-change-1',
        parentId: null,
        timestamp: '2026-09-18T00:00:00.100Z',
        provider: 'openrouter',
        modelId: 'model-first',
      }),
      JSON.stringify({
        type: 'thinking_level_change',
        id: 'thinking-change-1',
        parentId: 'model-change-1',
        timestamp: '2026-09-18T00:00:00.200Z',
        thinkingLevel: 'high',
      }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: 'thinking-change-1',
        timestamp: '2026-09-18T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'inspect the project' }],
          timestamp: 1_789_689_601_000,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        timestamp: '2026-09-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          provider: 'openrouter',
          model: 'model-second',
          content: [
            { type: 'thinking', thinking: 'check the tests' },
            { type: 'text', text: 'I will run the suite.' },
            {
              type: 'toolCall',
              id: 'call-test',
              name: 'bash',
              arguments: { command: 'bun test' },
            },
          ],
          usage: {
            input: 20,
            output: 5,
            cacheRead: 4,
            cacheWrite: 2,
            reasoning: 3,
            totalTokens: 31,
          },
          timestamp: 1_789_689_602_000,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tool-result-1',
        parentId: 'assistant-1',
        timestamp: '2026-09-18T00:00:03.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-test',
          toolName: 'bash',
          content: [{ type: 'text', text: '12 tests passed' }],
          isError: false,
          timestamp: 1_789_689_603_000,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-empty',
        parentId: 'tool-result-1',
        timestamp: '2026-09-18T00:00:04.000Z',
        message: {
          role: 'assistant',
          provider: 'openrouter',
          model: 'model-second',
          content: [
            { type: 'thinking', thinking: '\n\t' },
            { type: 'text', text: '   ' },
          ],
          timestamp: 1_789_689_604_000,
        },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'pi')).get('pi')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [] });
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'pi', externalId: 'pi-native-session' },
      agent: { name: 'Pi', version: '3' },
      project: { path: '/workspace/pi' },
      startedAt: '2026-09-18T00:00:00.000Z',
      endedAt: '2026-09-18T00:00:03.000Z',
      status: 'unknown',
      model: 'model-first',
      provider: 'openrouter',
      reasoningEffort: 'high',
      usage: {
        input: 20,
        output: 5,
        cacheRead: 4,
        cacheWrite: 2,
        reasoning: 3,
        total: 31,
        provenance: 'actual',
      },
    });
    expect(result.traces[0].messages).toHaveLength(3);
    expect(result.traces[0].messages[1]).toMatchObject({
      sourceKey: 'assistant-1',
      role: 'assistant',
      model: 'model-second',
      usage: {
        input: 20,
        output: 5,
        cacheRead: 4,
        cacheWrite: 2,
        reasoning: 3,
        total: 31,
        provenance: 'actual',
      },
      parts: [
        { type: 'reasoning', text: 'check the tests' },
        { type: 'text', text: 'I will run the suite.' },
        {
          type: 'tool_call',
          callId: 'call-test',
          name: 'bash',
          arguments: { command: 'bun test' },
        },
      ],
    });
    expect(result.traces[0].messages[2]).toMatchObject({
      sourceKey: 'tool-result-1',
      role: 'tool',
      parts: [{
        type: 'tool_result',
        callId: 'call-test',
        name: 'bash',
        content: [{ type: 'text', text: '12 tests passed' }],
      }],
    });
  });

  it('marks unsupported Pi session records as partial without dropping known messages', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'pi-future.jsonl'), [
      JSON.stringify({
        type: 'session', version: 4, id: 'pi-future',
        timestamp: '2026-09-18T00:00:00.000Z', cwd: '/workspace/pi',
      }),
      JSON.stringify({
        type: 'message', id: 'user-1', timestamp: '2026-09-18T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({
        type: 'future_record', id: 'future-1', timestamp: '2026-09-18T00:00:02.000Z',
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'pi')).get('pi')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].messages).toHaveLength(1);
    expect(result.traces[0].provenance).toMatchObject({
      completeness: 'partial',
      warnings: [
        'Pi session version 4 is not a verified native contract.',
        'Pi session contains unsupported record type "future_record".',
      ],
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(result.traces[0].provenance.warnings));
  });

  it('normalizes Copilot CLI events with authoritative shutdown usage and paired tools', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, '.copilot', 'session-state', 'copilot-native');
    await fs.ensureDir(path.join(sessionDirectory, 'checkpoints'));
    await fs.writeFile(path.join(sessionDirectory, 'events.jsonl'), [
      JSON.stringify({
        type: 'session.start', id: 'event-start', timestamp: '2026-09-18T00:00:00.000Z',
        data: {
          sessionId: 'copilot-native', version: 1, copilotVersion: '1.0.77',
          startTime: '2026-09-18T00:00:00.000Z',
          context: {
            cwd: '/workspace/copilot', gitRoot: '/workspace/copilot',
            repository: 'autohand-ai/cli', branch: 'agent/sdk-agent-discovery', headCommit: 'abc123',
          },
        },
      }),
      JSON.stringify({
        type: 'session.model_change', id: 'event-model', timestamp: '2026-09-18T00:00:00.100Z',
        data: { newModel: 'claude-sonnet-4.6', reasoningEffort: 'high' },
      }),
      JSON.stringify({
        type: 'session.usage_info', id: 'event-context', timestamp: '2026-09-18T00:00:00.200Z',
        data: { tokenLimit: 200_000, currentTokens: 1_200, messagesLength: 2 },
      }),
      JSON.stringify({
        type: 'system.message', id: 'event-system', timestamp: '2026-09-18T00:00:00.500Z',
        data: { role: 'system', content: 'Follow repository instructions.' },
      }),
      JSON.stringify({
        type: 'user.message', id: 'event-user', timestamp: '2026-09-18T00:00:01.000Z',
        data: {
          content: 'Inspect the project.', transformedContent: 'private transformed prompt',
          interactionId: 'interaction-1', attachments: [],
        },
      }),
      JSON.stringify({
        type: 'assistant.message', id: 'event-assistant', timestamp: '2026-09-18T00:00:02.000Z',
        data: {
          messageId: 'assistant-1', model: 'claude-sonnet-4.6',
          reasoningText: 'Check the tests.', reasoningOpaque: 'opaque private reasoning',
          encryptedContent: 'encrypted private reasoning', content: 'I will run the suite.',
          outputTokens: 11,
          toolRequests: [{
            toolCallId: 'call-test', name: 'bash', type: 'function',
            arguments: { command: 'bun test' },
          }],
        },
      }),
      JSON.stringify({
        type: 'tool.execution_start', id: 'event-tool-start', timestamp: '2026-09-18T00:00:02.100Z',
        data: { toolCallId: 'call-test', toolName: 'bash', arguments: { command: 'bun test' } },
      }),
      JSON.stringify({
        type: 'tool.execution_complete', id: 'event-tool-complete', timestamp: '2026-09-18T00:00:03.000Z',
        data: {
          toolCallId: 'call-test', toolName: 'bash', success: true,
          result: { content: '12 tests passed', detailedContent: '12 tests passed in 4s' },
          toolTelemetry: { privateMetric: 'must not be copied' },
        },
      }),
      JSON.stringify({
        type: 'assistant.usage', id: 'event-usage', timestamp: '2026-09-18T00:00:03.100Z',
        data: {
          model: 'claude-sonnet-4.6', inputTokens: 80, outputTokens: 11,
          reasoningTokens: 4, cacheReadTokens: 22, cacheWriteTokens: 2,
          reasoningEffort: 'high',
        },
      }),
      JSON.stringify({
        type: 'session.shutdown', id: 'event-shutdown', timestamp: '2026-09-18T00:00:04.000Z',
        data: {
          shutdownType: 'routine', currentModel: 'gpt-5.4', sessionStartTime: 1_789_689_600_000,
          totalPremiumRequests: 2, totalApiDurationMs: 3_000,
          codeChanges: { linesAdded: 1, linesRemoved: 0, filesModified: 1 },
          modelMetrics: {
            'claude-sonnet-4.6': {
              usage: {
                inputTokens: 70, outputTokens: 10, reasoningTokens: 4,
                cacheReadTokens: 20, cacheWriteTokens: 2,
              },
            },
            'gpt-5.4': {
              usage: {
                inputTokens: 5, outputTokens: 1, reasoningTokens: 0,
                cacheReadTokens: 1, cacheWriteTokens: 0,
              },
            },
          },
        },
      }),
    ].join('\n'));
    await fs.writeFile(path.join(sessionDirectory, 'session.db'), 'must not be read');
    await fs.writeJson(path.join(sessionDirectory, 'vscode.metadata.json'), {
      sessionId: 'metadata-decoy', messages: [{ role: 'user', content: 'must not be read' }],
    });
    await fs.writeFile(path.join(sessionDirectory, 'workspace.yaml'), 'secret: must not be read');
    await fs.writeFile(path.join(sessionDirectory, 'checkpoints', 'index.md'), 'must not be read');
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('copilot')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [], filesScanned: 1 });
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'copilot', externalId: 'copilot-native' },
      agent: { name: 'GitHub Copilot', version: '1.0.77' },
      project: {
        name: 'autohand-ai/cli', path: '/workspace/copilot',
        gitBranch: 'agent/sdk-agent-discovery', gitRef: 'abc123',
      },
      startedAt: '2026-09-18T00:00:00.000Z',
      endedAt: '2026-09-18T00:00:04.000Z',
      status: 'completed',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      contextWindow: 200_000,
      usage: {
        input: 75, output: 11, reasoning: 4, cacheRead: 21, cacheWrite: 2,
        total: 86, provenance: 'actual',
      },
      provenance: { completeness: 'complete', warnings: [] },
    });
    expect(result.traces[0].messages).toMatchObject([
      {
        sourceKey: 'event-system', role: 'system',
        parts: [{ type: 'text', text: 'Follow repository instructions.' }],
      },
      {
        sourceKey: 'event-user', role: 'user',
        parts: [{ type: 'text', text: 'Inspect the project.' }],
      },
      {
        sourceKey: 'assistant-1', role: 'assistant', model: 'claude-sonnet-4.6',
        usage: { output: 11, provenance: 'actual' },
        parts: [
          { type: 'reasoning', text: 'Check the tests.' },
          { type: 'text', text: 'I will run the suite.' },
          {
            type: 'tool_call', callId: 'call-test', name: 'bash',
            arguments: { command: 'bun test' },
          },
        ],
      },
      {
        sourceKey: 'event-tool-complete', role: 'tool',
        parts: [{
          type: 'tool_result', callId: 'call-test', name: 'bash', content: '12 tests passed in 4s',
        }],
      },
    ]);
    const serialized = JSON.stringify(result.traces);
    expect(serialized).not.toContain('private transformed prompt');
    expect(serialized).not.toContain('opaque private reasoning');
    expect(serialized).not.toContain('encrypted private reasoning');
    expect(serialized).not.toContain('privateMetric');
    expect(serialized).not.toContain('metadata-decoy');
  });

  it('normalizes VS Code Copilot chat snapshots with whole-turn model usage', async () => {
    const root = await tempRoot();
    await fs.writeJson(path.join(root, 'copilot-vscode.json'), {
      version: 3,
      sessionId: 'copilot-vscode',
      creationDate: Date.parse('2026-09-18T00:00:00.000Z'),
      lastMessageDate: Date.parse('2026-09-18T00:00:05.000Z'),
      responderUsername: 'GitHub Copilot',
      requests: [{
        requestId: 'request-1',
        message: { text: 'Inspect the VS Code chat store.', parts: [] },
        responseId: 'response-1',
        timestamp: Date.parse('2026-09-18T00:00:01.000Z'),
        responseTimestamp: Date.parse('2026-09-18T00:00:02.000Z'),
        modelId: 'gpt-5.4',
        promptTokens: 999,
        completionTokens: 999,
        modelTotals: [
          { model: 'gpt-5.4', inputTokens: 40, cachedTokens: 7, outputTokens: 10 },
          { model: 'gpt-5.4-mini', inputTokens: 5, cachedTokens: 1, outputTokens: 2 },
        ],
        response: [
          { value: 'I will inspect it.' },
          { kind: 'thinking', value: ['Check ', 'the schema.'] },
          {
            kind: 'toolInvocationSerialized', toolCallId: 'call-read', toolId: 'read_file',
            isComplete: true, toolSpecificData: { command: 'read README.md' },
            resultDetails: { output: 'read complete' },
          },
          {
            kind: 'textEditGroup', uri: { fsPath: '/workspace/copilot/README.md' },
            edits: [], done: true,
          },
          { kind: 'warning', content: { value: 'One optional file was skipped.' } },
        ],
      }],
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'copilot')).get('copilot')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [] });
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'copilot', externalId: 'copilot-vscode' },
      startedAt: '2026-09-18T00:00:00.000Z',
      endedAt: '2026-09-18T00:00:05.000Z',
      status: 'completed',
      model: 'gpt-5.4',
      usage: {
        input: 45, output: 12, cacheRead: 8, total: 57, provenance: 'actual',
      },
    });
    expect(result.traces[0].messages).toMatchObject([
      {
        sourceKey: 'request-1', role: 'user', timestamp: '2026-09-18T00:00:01.000Z',
        parts: [{ type: 'text', text: 'Inspect the VS Code chat store.' }],
      },
      {
        sourceKey: 'response-1', role: 'assistant', model: 'gpt-5.4',
        timestamp: '2026-09-18T00:00:02.000Z',
        usage: { input: 45, output: 12, cacheRead: 8, total: 57, provenance: 'actual' },
        parts: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'reasoning', text: 'Check the schema.' },
          {
            type: 'tool_call', callId: 'call-read', name: 'read_file',
            arguments: { command: 'read README.md' },
          },
          {
            type: 'tool_result', callId: 'call-read', name: 'read_file',
            content: { output: 'read complete' },
          },
          { type: 'file_change', path: '/workspace/copilot/README.md' },
          { type: 'error', code: 'copilot_warning', message: 'One optional file was skipped.' },
        ],
      },
    ]);
  });

  it('does not index empty VS Code Copilot chat snapshots', async () => {
    const root = await tempRoot();
    await fs.writeJson(path.join(root, 'empty.json'), {
      version: 3,
      sessionId: 'copilot-empty',
      creationDate: Date.parse('2026-09-18T00:00:00.000Z'),
      requests: [],
      inputState: { text: 'unsent draft must not be indexed' },
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'copilot')).get('copilot')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [], filesScanned: 1 });
    expect(result.traces).toEqual([]);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0].traceIds).toEqual([]);
  });

  it('replays VS Code Copilot mutation logs and deduplicates copied session identities', async () => {
    const root = await tempRoot();
    const firstRequest = {
      requestId: 'request-1', message: { text: 'First question.' },
      responseId: 'response-1', response: [{ value: 'First answer.' }],
      timestamp: Date.parse('2026-09-18T00:00:01.000Z'),
    };
    const secondRequest = {
      requestId: 'request-2', message: { text: 'Second question.' },
      responseId: 'response-2', response: [{ value: 'Second answer.' }],
      timestamp: Date.parse('2026-09-18T00:00:03.000Z'),
    };
    await fs.writeJson(path.join(root, 'copy.json'), {
      version: 3, sessionId: 'same-vscode-session',
      creationDate: Date.parse('2026-09-18T00:00:00.000Z'),
      requests: [firstRequest],
    });
    await fs.writeFile(path.join(root, 'copy.jsonl'), [
      JSON.stringify({
        kind: 0,
        v: {
          version: 3, sessionId: 'same-vscode-session',
          creationDate: Date.parse('2026-09-18T00:00:00.000Z'),
          requests: [firstRequest], inputState: { text: 'draft must not be included' },
        },
      }),
      JSON.stringify({ kind: 2, k: ['requests'], v: [secondRequest] }),
      JSON.stringify({
        kind: 1, k: ['lastMessageDate'], v: Date.parse('2026-09-18T00:00:04.000Z'),
      }),
      JSON.stringify({ kind: 3, k: ['inputState'] }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'copilot')).get('copilot')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [] });
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      id: createCanonicalTraceId('copilot', 'same-vscode-session', 'native-session-id'),
      source: { externalId: 'same-vscode-session', recordPath: path.join(root, 'copy.jsonl') },
      endedAt: '2026-09-18T00:00:04.000Z',
      status: 'completed',
    });
    expect(result.traces[0].messages).toHaveLength(4);
    expect(result.traces[0].messages.map((message) => message.sourceKey)).toEqual([
      'request-1', 'response-1', 'request-2', 'response-2',
    ]);
    expect(result.sourceFiles).toHaveLength(2);
    expect(new Set(result.sourceFiles.flatMap((source) => source.traceIds))).toEqual(
      new Set([result.traces[0].id]),
    );
    expect(JSON.stringify(result.traces)).not.toContain('draft must not be included');
  });

  it('marks unsupported Copilot contracts partial without dropping known messages', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'future.jsonl'), [
      JSON.stringify({
        kind: 0,
        v: {
          version: 4, sessionId: 'copilot-future',
          creationDate: Date.parse('2026-09-18T00:00:00.000Z'),
          requests: [{
            requestId: 'request-1', message: { text: 'Known question.' },
            responseId: 'response-1', response: [
              { value: 'Known answer.' },
              { kind: 'futureResponse', opaque: true },
            ],
          }],
        },
      }),
      JSON.stringify({ kind: 9, k: ['future'], v: true }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'copilot')).get('copilot')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].messages).toHaveLength(2);
    expect(result.traces[0].provenance).toMatchObject({
      completeness: 'partial',
      warnings: [
        'Copilot VS Code chat version 4 is not a verified native contract.',
        'Copilot VS Code mutation log contains unsupported entry kind "9".',
        'Copilot VS Code response contains unsupported part kind "futureResponse".',
      ],
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(result.traces[0].provenance.warnings));
  });

  it('marks unsupported Copilot CLI versions and event types partial', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'events.jsonl'), [
      JSON.stringify({
        type: 'session.start', id: 'event-start', timestamp: '2026-09-18T00:00:00.000Z',
        data: { sessionId: 'copilot-future-cli', version: 2, copilotVersion: '2.0.0' },
      }),
      JSON.stringify({
        type: 'user.message', id: 'event-user', timestamp: '2026-09-18T00:00:01.000Z',
        data: { content: 'Known question.' },
      }),
      JSON.stringify({
        type: 'future.event', id: 'event-future', timestamp: '2026-09-18T00:00:02.000Z',
        data: { opaque: true },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'copilot')).get('copilot')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].messages).toHaveLength(1);
    expect(result.traces[0].provenance).toMatchObject({
      completeness: 'partial',
      warnings: [
        'Copilot CLI session version 2 is not a verified native contract.',
        'Copilot CLI contains unsupported event type "future.event".',
      ],
    });
    expect(result.truncated).toBe(true);
  });

  it('normalizes Droid session-v2 messages with allowlisted sibling settings', async () => {
    const root = await tempRoot();
    const sessionPath = path.join(root, 'project', 'droid-native.jsonl');
    await fs.ensureDir(path.dirname(sessionPath));
    await fs.writeJson(path.join(root, 'project', 'droid-native.settings.json'), {
      model: 'claude-opus-4-6',
      providerLock: 'anthropic',
      reasoningEffort: 'high',
      assistantActiveTimeMs: 705,
      apiKey: 'state-only secret must not be ingested',
    });
    await fs.writeFile(sessionPath, [
      JSON.stringify({
        type: 'session_start', id: 'droid-native', version: 2,
        cwd: '/workspace/droid', owner: 'local', sessionTitle: 'Native session',
      }),
      JSON.stringify({
        type: 'message', id: 'user-1', timestamp: '2026-09-18T00:00:01.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect the project' },
            { type: 'text', text: 'include tests' },
          ],
        },
      }),
      JSON.stringify({
        type: 'message', id: 'assistant-1', parentId: 'user-1',
        timestamp: '2026-09-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'check the tests' },
            { type: 'text', text: 'I will inspect it.' },
            { type: 'tool_use', id: 'call-test', name: 'Bash', input: { command: 'bun test' } },
          ],
          usage: { input_tokens: 10, output_tokens: 4, cache_read_tokens: 3 },
        },
      }),
      JSON.stringify({
        type: 'message', id: 'tool-1', parentId: 'assistant-1',
        timestamp: '2026-09-18T00:00:03.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-test', content: 'tests passed' }],
        },
      }),
      JSON.stringify({
        type: 'message', id: 'assistant-2', parentId: 'tool-1',
        timestamp: '2026-09-18T00:00:04.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
          usage: { input_tokens: 20, output_tokens: 2, cache_read_tokens: 5 },
        },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'droid')).get('droid')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [], filesScanned: 1 });
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'droid', externalId: 'droid-native' },
      agent: { name: 'Droid', version: '2' },
      project: { path: '/workspace/droid' },
      startedAt: '2026-09-18T00:00:01.000Z',
      endedAt: '2026-09-18T00:00:04.000Z',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      reasoningEffort: 'high',
      usage: {
        input: 30,
        output: 6,
        cacheRead: 8,
        total: 36,
        provenance: 'actual',
      },
      provenance: { completeness: 'complete', warnings: [] },
    });
    expect(result.traces[0].messages.flatMap((message) => message.parts)).toEqual([
      { type: 'text', text: 'inspect the project\ninclude tests' },
      { type: 'reasoning', text: 'check the tests' },
      { type: 'text', text: 'I will inspect it.' },
      { type: 'tool_call', name: 'Bash', callId: 'call-test', arguments: { command: 'bun test' } },
      { type: 'tool_result', name: 'Bash', callId: 'call-test', content: 'tests passed' },
      { type: 'text', text: 'Done.' },
    ]);
    expect(result.traces[0].messages[1]).toMatchObject({ model: 'claude-opus-4-6' });
    expect(result.traces[0].messages[3]).toMatchObject({ model: 'claude-opus-4-6' });
    expect(JSON.stringify(result.traces)).not.toContain('state-only secret must not be ingested');
  });

  it('deduplicates copied Droid sessions by their native session id', async () => {
    const root = await tempRoot();
    const firstPath = path.join(root, 'project-a', 'same-session.jsonl');
    const secondPath = path.join(root, 'project-b', 'same-session.jsonl');
    await fs.ensureDir(path.dirname(firstPath));
    await fs.ensureDir(path.dirname(secondPath));
    await fs.writeFile(firstPath, [
      JSON.stringify({ type: 'session_start', id: 'same-session', version: 2, cwd: '/workspace/a' }),
      JSON.stringify({
        type: 'message', id: 'user-1',
        message: { role: 'user', content: [{ type: 'text', text: 'first copy' }] },
      }),
    ].join('\n'));
    await fs.writeFile(secondPath, [
      JSON.stringify({ type: 'session_start', id: 'same-session', version: 2, cwd: '/workspace/b' }),
      JSON.stringify({
        type: 'message', id: 'user-1',
        message: { role: 'user', content: [{ type: 'text', text: 'second copy' }] },
      }),
      JSON.stringify({
        type: 'message', id: 'assistant-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'more complete copy' }] },
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'droid')).get('droid')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'same-session' },
      project: { path: '/workspace/b' },
    });
    expect(result.traces[0].messages).toHaveLength(2);
    expect(result.sourceFiles).toHaveLength(2);
    expect(new Set(result.sourceFiles.flatMap((source) => source.traceIds))).toEqual(
      new Set([result.traces[0].id]),
    );
  });

  it('tracks Droid settings changes and rejects a symlinked settings sidecar', async () => {
    const root = await tempRoot();
    const sessionPath = path.join(root, 'droid-settings.jsonl');
    const settingsPath = path.join(root, 'droid-settings.settings.json');
    await fs.writeFile(sessionPath, JSON.stringify({
      type: 'session_start', id: 'droid-settings', version: 2, cwd: '/workspace/droid',
    }));
    await fs.writeJson(settingsPath, { model: 'model-one', reasoningEffort: 'low' });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'droid')).get('droid')!;

    const first = await adapter.scan();
    await fs.writeJson(settingsPath, { model: 'model-two-expanded', reasoningEffort: 'high' });
    const changed = await adapter.scan({
      knownFingerprints: { [first.sourceFiles[0].key]: first.sourceFiles[0].fingerprint },
    });

    expect(changed.sourceFiles[0].changed).toBe(true);
    expect(changed.traces[0]).toMatchObject({
      model: 'model-two-expanded',
      reasoningEffort: 'high',
    });

    const unrelated = path.join(root, 'unrelated.json');
    await fs.remove(settingsPath);
    await fs.writeJson(unrelated, { model: 'must-not-be-read', apiKey: 'secret' });
    await fs.symlink(unrelated, settingsPath);
    const linked = await adapter.scan();

    expect(linked).toMatchObject({ filesScanned: 0, truncated: true, traces: [] });
    expect(linked.warnings).toContain('Skipped unsafe trace sidecar for droid-settings.jsonl.');
  });

  it('marks unsupported Droid session schemas partial without dropping known messages', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'future.jsonl'), [
      JSON.stringify({ type: 'session_start', id: 'future-session', version: 3, cwd: '/workspace/future' }),
      JSON.stringify({
        type: 'message', id: 'user-1',
        message: { role: 'user', content: [{ type: 'text', text: 'known message' }] },
      }),
      JSON.stringify({ type: 'future.record', payload: { opaque: true } }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'droid')).get('droid')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'future-session' },
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'known message' }] }],
      provenance: {
        completeness: 'partial',
        warnings: [
          'Droid session schema 3 is not a verified native contract.',
          'Droid session contains unsupported record type "future.record".',
        ],
      },
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(result.traces[0].provenance.warnings));
  });

  it('normalizes Grok session directories while reading only the trace allowlist', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, 'workspace', 'grok-native');
    await fs.ensureDir(sessionDirectory);
    const summary = JSON.stringify({
      info: { id: 'grok-native', cwd: '/workspace/grok' },
      created_at: '2026-09-18T00:00:00.000Z',
      updated_at: '2026-09-18T00:00:05.000Z',
      current_model_id: 'grok-4.6',
      git_remotes: ['git@github.com:autohand-ai/cli.git'],
      head_branch: 'agent/sdk-agent-discovery',
      head_commit: 'abc123',
      session_kind: 'parent',
    });
    const history = JSON.stringify({ type: 'user', content: 'inspect the project' });
    const updates = [
      {
        method: 'session/update',
        _meta: { agentTimestampMs: Date.parse('2026-09-18T00:00:02.000Z') },
        params: {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-read',
            title: 'read_file',
            _meta: {
              'x.ai/tool': {
                name: 'read_file', kind: 'read', input: { target_file: 'README.md' },
              },
            },
          },
        },
      },
      {
        method: 'session/update',
        _meta: { agentTimestampMs: Date.parse('2026-09-18T00:00:03.000Z') },
        params: {
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-read',
            status: 'completed',
            rawOutput: { output: 'read complete' },
          },
        },
      },
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'hook_execution',
            event_name: 'PostToolUse',
            runs: [{ status: { status: 'failed' } }],
          },
        },
      },
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'subagent_spawned',
            child_session_id: 'grok-child',
            parent_session_id: 'grok-native',
            subagent_type: 'explore',
          },
        },
      },
      {
        method: '_x.ai/session/update',
        params: {
          update: {
            sessionUpdate: 'turn_completed',
            prompt_id: 'prompt-1',
            stop_reason: 'end_turn',
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              cachedReadTokens: 60,
              cacheCreationTokens: 3,
              reasoningTokens: 5,
              totalTokens: 120,
              costUsdTicks: 123_000_000,
            },
          },
        },
      },
    ].map((record) => JSON.stringify(record)).join('\n');
    const allowlisted = new Map([
      ['summary.json', summary],
      ['chat_history.jsonl', history],
      ['updates.jsonl', updates],
    ]);
    for (const [name, content] of allowlisted) {
      await fs.writeFile(path.join(sessionDirectory, name), content);
    }
    for (const name of [
      'announcement_state.json',
      'events.jsonl',
      'feedback.jsonl',
      'hunk_records.jsonl',
      'plan.json',
      'prompt_context.json',
      'resources_state.json',
      'rewind_points.jsonl',
      'signals.json',
    ]) {
      await fs.writeFile(path.join(sessionDirectory, name), JSON.stringify({
        info: { id: `decoy-${name}` },
        messages: [{ role: 'user', content: 'must not be read' }],
      }));
    }
    const adapter = createTraceSourceRegistry(registryOptions(root, 'grok')).get('grok')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [], filesScanned: 1 });
    expect(result.bytesRead).toBe([...allowlisted.values()]
      .reduce((total, content) => total + Buffer.byteLength(content), 0));
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'grok', externalId: 'grok-native', recordPath: path.join(sessionDirectory, 'summary.json') },
      agent: { name: 'Grok' },
      project: {
        path: '/workspace/grok',
        gitRemote: 'git@github.com:autohand-ai/cli.git',
        gitBranch: 'agent/sdk-agent-discovery',
        gitRef: 'abc123',
      },
      startedAt: '2026-09-18T00:00:00.000Z',
      endedAt: '2026-09-18T00:00:05.000Z',
      model: 'grok-4.6',
      usage: {
        input: 100,
        output: 20,
        reasoning: 5,
        cacheRead: 60,
        cacheWrite: 3,
        total: 120,
        provenance: 'actual',
      },
      relationships: [{
        type: 'child',
        traceId: createCanonicalTraceId('grok', 'grok-child', 'native-session-id'),
      }],
      provenance: { completeness: 'complete', warnings: [] },
    });
    expect(result.traces[0].messages).toMatchObject([
      {
        role: 'user',
        parts: [{ type: 'text', text: 'inspect the project' }],
      },
      {
        role: 'assistant',
        timestamp: '2026-09-18T00:00:02.000Z',
        parts: [{
          type: 'tool_call', name: 'read_file', callId: 'call-read',
          arguments: { target_file: 'README.md' },
        }],
      },
      {
        role: 'tool',
        timestamp: '2026-09-18T00:00:03.000Z',
        parts: [{
          type: 'tool_result', name: 'read_file', callId: 'call-read',
          content: 'read complete',
        }],
      },
      {
        role: 'system',
        parts: [{
          type: 'error', code: 'hook_execution_failed', message: 'Grok PostToolUse hook failed.',
        }],
      },
    ]);
    expect(JSON.stringify(result.traces)).not.toContain('must not be read');
    expect(JSON.stringify(result.traces)).not.toContain('costUsdTicks');
  });

  it('coalesces Grok ACP chunks and deduplicates authoritative turn usage', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, 'workspace', 'grok-stream');
    await fs.ensureDir(sessionDirectory);
    await fs.writeJson(path.join(sessionDirectory, 'summary.json'), {
      info: { id: 'grok-stream', cwd: '/workspace/grok' },
      current_model_id: 'grok-4.6-build',
    });
    const update = (
      sessionUpdate: string,
      fields: Record<string, unknown>,
      timestamp: string,
    ): string => JSON.stringify({
      method: '_x.ai/session/update',
      params: {
        _meta: { agentTimestampMs: Date.parse(timestamp) },
        update: { sessionUpdate, ...fields },
      },
    });
    await fs.writeFile(path.join(sessionDirectory, 'updates.jsonl'), [
      update('user_message_chunk', { content: { type: 'text', text: 'inspect ' } }, '2026-09-18T00:00:01.000Z'),
      update('user_message_chunk', { content: { type: 'text', text: 'the project' } }, '2026-09-18T00:00:01.100Z'),
      update('agent_thought_chunk', { content: { type: 'text', text: 'check ' } }, '2026-09-18T00:00:02.000Z'),
      update('agent_thought_chunk', { content: { type: 'text', text: 'tests' } }, '2026-09-18T00:00:02.100Z'),
      update('tool_call', {
        toolCallId: 'call-test', title: 'run_tests', rawInput: { command: 'bun test' },
      }, '2026-09-18T00:00:02.200Z'),
      update('tool_call_update', {
        toolCallId: 'call-test', status: 'completed', rawOutput: { output: 'passed' },
      }, '2026-09-18T00:00:02.300Z'),
      update('agent_message_chunk', { content: { type: 'text', text: 'done' } }, '2026-09-18T00:00:03.000Z'),
      update('turn_completed', {
        prompt_id: 'prompt-1',
        stop_reason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cachedReadTokens: 60,
          cacheCreationTokens: 3,
          reasoningTokens: 5,
          totalTokens: 120,
          modelUsage: {
            'grok-4.6-build': { inputTokens: 100, outputTokens: 20 },
          },
        },
      }, '2026-09-18T00:00:04.000Z'),
      update('turn_completed', {
        prompt_id: 'prompt-1',
        stop_reason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      }, '2026-09-18T00:00:04.100Z'),
      update('plan', { entries: [] }, '2026-09-18T00:00:04.200Z'),
      update('user_message_chunk', { content: { type: 'text', text: 'verify' } }, '2026-09-18T00:00:05.000Z'),
      update('agent_message_chunk', { content: { type: 'text', text: 'verified' } }, '2026-09-18T00:00:06.000Z'),
      update('turn_completed', {
        prompt_id: 'prompt-2',
        stop_reason: 'end_turn',
        usage: {
          totalTokens: 90,
          modelUsage: {
            'grok-4.6-build': {
              inputTokens: 80,
              outputTokens: 10,
              cachedReadTokens: 50,
              reasoningTokens: 2,
              totalTokens: 90,
            },
          },
        },
      }, '2026-09-18T00:00:07.000Z'),
    ].join('\n'));
    await fs.writeFile(path.join(sessionDirectory, 'chat_history.jsonl'), JSON.stringify({
      type: 'user', content: 'fallback duplicate must not be included',
    }));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'grok')).get('grok')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [] });
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'grok-stream' },
      status: 'completed',
      model: 'grok-4.6-build',
      usage: {
        input: 180,
        output: 30,
        reasoning: 7,
        cacheRead: 110,
        cacheWrite: 3,
        total: 210,
        provenance: 'actual',
      },
    });
    expect(result.traces[0].messages).toHaveLength(7);
    expect(result.traces[0].messages[0]).toMatchObject({
      role: 'user',
      timestamp: '2026-09-18T00:00:01.000Z',
      parts: [{ type: 'text', text: 'inspect the project' }],
    });
    expect(result.traces[0].messages[1]).toMatchObject({
      role: 'assistant',
      timestamp: '2026-09-18T00:00:02.000Z',
      parts: [{ type: 'reasoning', text: 'check tests' }],
    });
    expect(result.traces[0].messages[2]).toMatchObject({
      role: 'assistant',
      parts: [{
        type: 'tool_call', name: 'run_tests', callId: 'call-test',
        arguments: { command: 'bun test' },
      }],
    });
    expect(result.traces[0].messages[3]).toMatchObject({
      role: 'tool',
      parts: [{
        type: 'tool_result', name: 'run_tests', callId: 'call-test', content: 'passed',
      }],
    });
    expect(result.traces[0].messages[4]).toMatchObject({
      role: 'assistant',
      usage: {
        input: 100,
        output: 20,
        reasoning: 5,
        cacheRead: 60,
        cacheWrite: 3,
        total: 120,
        provenance: 'actual',
      },
      parts: [{ type: 'text', text: 'done' }],
    });
    expect(result.traces[0].messages[5]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'verify' }],
    });
    expect(result.traces[0].messages[6]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'verified' }],
    });
    expect(JSON.stringify(result.traces)).not.toContain('fallback duplicate');
  });

  it('deduplicates Grok copies by native identity and marks unknown updates partial', async () => {
    const root = await tempRoot();
    const first = path.join(root, 'workspace-a', 'copy-a');
    const second = path.join(root, 'workspace-b', 'copy-b');
    await fs.ensureDir(first);
    await fs.ensureDir(second);
    await fs.writeJson(path.join(first, 'summary.json'), {
      info: { id: 'same-grok-session', cwd: '/workspace/a' },
      created_at: '2026-09-18T00:00:00.000Z',
    });
    await fs.writeFile(path.join(first, 'chat_history.jsonl'), JSON.stringify({
      type: 'user', content: 'less complete copy',
    }));
    await fs.writeJson(path.join(second, 'summary.json'), {
      info: { id: 'same-grok-session', cwd: '/workspace/b' },
      created_at: '2026-09-18T00:00:00.000Z',
      session_kind: 'subagent_fork',
      parent_session_id: 'grok-parent',
    });
    await fs.writeFile(path.join(second, 'chat_history.jsonl'), [
      JSON.stringify({ type: 'user', content: 'more complete copy' }),
      JSON.stringify({ type: 'assistant', content: 'known response' }),
    ].join('\n'));
    await fs.writeFile(path.join(second, 'updates.jsonl'), JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'future_update', opaque: true } },
    }));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'grok')).get('grok')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { externalId: 'same-grok-session' },
      project: { path: '/workspace/b' },
      relationships: [{
        type: 'fork',
        traceId: createCanonicalTraceId('grok', 'grok-parent', 'native-session-id'),
      }],
      provenance: {
        completeness: 'partial',
        warnings: ['Grok updates contain unsupported sessionUpdate "future_update".'],
      },
    });
    expect(result.traces[0].messages).toHaveLength(2);
    expect(result.sourceFiles).toHaveLength(2);
    expect(new Set(result.sourceFiles.flatMap((source) => source.traceIds))).toEqual(
      new Set([result.traces[0].id]),
    );
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('Grok updates contain unsupported sessionUpdate "future_update".');
  });

  it('links Grok child sessions from the parent update stream', async () => {
    const root = await tempRoot();
    const parentDirectory = path.join(root, 'workspace-parent', 'grok-parent');
    const childDirectory = path.join(root, 'workspace-child', 'grok-child');
    await fs.ensureDir(parentDirectory);
    await fs.ensureDir(childDirectory);
    await fs.writeJson(path.join(parentDirectory, 'summary.json'), {
      info: { id: 'grok-parent', cwd: '/workspace/parent' },
    });
    await fs.writeFile(path.join(parentDirectory, 'updates.jsonl'), JSON.stringify({
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'subagent_spawned',
          child_session_id: 'grok-child',
          parent_session_id: 'grok-parent',
          subagent_type: 'explore',
        },
      },
    }));
    await fs.writeJson(path.join(childDirectory, 'summary.json'), {
      info: { id: 'grok-child', cwd: '/workspace/child' },
      session_kind: 'subagent',
    });
    const adapter = createTraceSourceRegistry(registryOptions(root, 'grok')).get('grok')!;

    const result = await adapter.scan();

    const parent = result.traces.find((trace) => trace.source.externalId === 'grok-parent');
    const child = result.traces.find((trace) => trace.source.externalId === 'grok-child');
    expect(parent?.relationships).toContainEqual({
      type: 'child',
      traceId: createCanonicalTraceId('grok', 'grok-child', 'native-session-id'),
    });
    expect(child?.relationships).toContainEqual({
      type: 'parent',
      traceId: createCanonicalTraceId('grok', 'grok-parent', 'native-session-id'),
    });
  });

  it('normalizes Kimi wire protocol events, per-step usage, and state metadata', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, 'wd_project', 'session-kimi');
    const wireDirectory = path.join(sessionDirectory, 'agents', 'main');
    await fs.ensureDir(wireDirectory);
    await fs.writeJson(path.join(sessionDirectory, 'state.json'), {
      id: 'session-kimi',
      version: '0.7.0',
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:09.000Z',
      workDir: '/workspace/kimi',
      lastPrompt: 'state-only prompt must not be ingested',
      agents: { main: { type: 'main', homedir: wireDirectory } },
    });
    await fs.writeFile(path.join(wireDirectory, 'wire.jsonl'), [
      JSON.stringify({
        type: 'metadata', protocol_version: '1.4', created_at: '2026-09-18T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'turn.prompt', time: 1_789_689_601_000, origin: { kind: 'user' },
        input: [{ type: 'text', text: 'inspect the project' }],
      }),
      JSON.stringify({
        type: 'llm.request', time: 1_789_689_601_100, model: 'k3', provider: 'kimi',
        thinkingEffort: 'high', turnStep: 1,
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_602_000,
        event: {
          type: 'content.part', uuid: 'part-text', turnId: 'turn-1', step: 1,
          part: { type: 'text', text: 'I will inspect it.' },
        },
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_602_100,
        event: {
          type: 'step.end', uuid: 'step-end-1', turnId: 'turn-1', step: 1,
          usage: { inputOther: 10, output: 2, inputCacheRead: 5, inputCacheCreation: 1 },
        },
      }),
      JSON.stringify({
        type: 'usage.record', time: 1_789_689_602_200, usageScope: 'turn', model: 'kimi-code/k3',
        usage: { inputOther: 10, output: 2, inputCacheRead: 5, inputCacheCreation: 1 },
      }),
      JSON.stringify({
        type: 'llm.request', time: 1_789_689_603_000, model: 'kimi-for-coding', provider: 'kimi',
        thinkingEffort: 'on', turnStep: 2,
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_603_100,
        event: {
          type: 'content.part', uuid: 'part-thinking', turnId: 'turn-1', step: 2,
          part: { type: 'think', think: 'check the tests' },
        },
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_603_200,
        event: {
          type: 'content.part', uuid: 'part-empty-thinking', turnId: 'turn-1', step: 2,
          part: { type: 'think', think: '\n\t' },
        },
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_604_000,
        event: {
          type: 'tool.call', uuid: 'tool-event', toolCallId: 'call-test', turnId: 'turn-1', step: 2,
          name: 'Bash', args: { command: 'bun test' },
        },
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_604_100,
        event: {
          type: 'step.end', uuid: 'step-end-2', turnId: 'turn-1', step: 2,
          usage: { inputOther: 20, output: 4, inputCacheRead: 7, inputCacheCreation: 0 },
        },
      }),
      JSON.stringify({
        type: 'usage.record', time: 1_789_689_604_200, usageScope: 'turn',
        model: 'kimi-code/kimi-for-coding',
        usage: { inputOther: 20, output: 4, inputCacheRead: 7, inputCacheCreation: 0 },
      }),
      JSON.stringify({
        type: 'context.append_loop_event', time: 1_789_689_605_000,
        event: {
          type: 'tool.result', toolCallId: 'call-test', parentUuid: 'tool-event',
          result: { output: 'test failed', isError: true },
        },
      }),
      JSON.stringify({ type: 'turn.cancel', time: 1_789_689_606_000, turnId: 'turn-1' }),
      JSON.stringify({
        type: 'context.apply_compaction', time: 1_789_689_607_000,
        summary: 'Earlier context was compacted.', compactedCount: 4,
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'kimi')).get('kimi')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ truncated: false, warnings: [], filesScanned: 1 });
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      source: { harness: 'kimi', externalId: 'session-kimi' },
      agent: { name: 'Kimi Code', version: '0.7.0' },
      project: { path: '/workspace/kimi' },
      startedAt: '2026-09-18T00:00:00.000Z',
      endedAt: '2026-09-18T00:00:09.000Z',
      model: 'kimi-code/k3',
      provider: 'kimi',
      reasoningEffort: 'high',
      usage: {
        input: 30,
        output: 6,
        cacheRead: 12,
        cacheWrite: 1,
        total: 36,
        provenance: 'actual',
      },
      provenance: { completeness: 'complete', warnings: [] },
    });
    expect(result.traces[0].messages.map((message) => message.role)).toEqual([
      'user', 'assistant', 'assistant', 'assistant', 'tool', 'system', 'system',
    ]);
    expect(result.traces[0].messages.flatMap((message) => message.parts)).toEqual([
      { type: 'text', text: 'inspect the project' },
      { type: 'text', text: 'I will inspect it.' },
      { type: 'reasoning', text: 'check the tests' },
      { type: 'tool_call', name: 'Bash', callId: 'call-test', arguments: { command: 'bun test' } },
      { type: 'tool_result', name: 'Bash', callId: 'call-test', content: 'test failed', isError: true },
      { type: 'error', code: 'turn_cancelled', message: 'Kimi turn cancelled.' },
      { type: 'text', text: 'Earlier context was compacted.' },
    ]);
    expect(JSON.stringify(result.traces)).not.toContain('state-only prompt must not be ingested');
    expect(result.traces[0].messages[1]).toMatchObject({
      model: 'kimi-code/k3',
      usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 1, provenance: 'actual' },
    });
    expect(result.traces[0].messages[3]).toMatchObject({
      model: 'kimi-code/kimi-for-coding',
      usage: { input: 20, output: 4, cacheRead: 7, cacheWrite: 0, provenance: 'actual' },
    });
  });

  it('uses Kimi agent identity and links subagents to the main wire trace', async () => {
    const root = await tempRoot();
    const sessionDirectory = path.join(root, 'wd_project', 'session-team');
    const wireDirectory = path.join(sessionDirectory, 'agents', 'agent-0');
    const wirePath = path.join(wireDirectory, 'wire.jsonl');
    await fs.ensureDir(wireDirectory);
    await fs.writeJson(path.join(sessionDirectory, 'state.json'), {
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:02.000Z',
      agents: {
        main: { type: 'main', homedir: path.join(sessionDirectory, 'agents', 'main') },
        'agent-0': { type: 'sub', parentAgentId: 'main', homedir: wireDirectory },
      },
    });
    await fs.writeFile(wirePath, [
      JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: '2026-09-18T00:00:00.000Z' }),
      JSON.stringify({
        type: 'turn.prompt', time: 1_789_689_601_000, origin: { kind: 'system_trigger' },
        input: [{ type: 'text', text: 'review the change' }],
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'kimi')).get('kimi')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].source.externalId).toBe('session-team:agent-0');
    expect(result.traces[0].relationships).toEqual([{
      type: 'parent',
      traceId: createCanonicalTraceId(
        'kimi',
        'session-team',
        path.join(sessionDirectory, 'agents', 'main', 'wire.jsonl'),
      ),
    }]);
  });

  it('marks Kimi legacy and future wire protocols partial without inventing usage', async () => {
    const root = await tempRoot();
    const legacyDirectory = path.join(root, 'wd_project', 'session-legacy', 'agents', 'main');
    const futureDirectory = path.join(root, 'wd_project', 'session-future', 'agents', 'main');
    await fs.ensureDir(legacyDirectory);
    await fs.ensureDir(futureDirectory);
    await fs.writeFile(path.join(legacyDirectory, 'wire.jsonl'), [
      JSON.stringify({ type: 'metadata', protocol_version: '1.0', created_at: '2026-09-18T00:00:00.000Z' }),
      JSON.stringify({
        type: 'context.append_message', time: 1_789_689_601_000,
        message: { role: 'assistant', content: [{ type: 'think', think: 'must not be guessed' }] },
      }),
    ].join('\n'));
    await fs.writeFile(path.join(futureDirectory, 'wire.jsonl'), [
      JSON.stringify({ type: 'metadata', protocol_version: '2.0', created_at: '2026-09-18T00:00:00.000Z' }),
      JSON.stringify({
        type: 'turn.prompt', time: 1_789_689_601_000, origin: { kind: 'user' },
        input: [{ type: 'text', text: 'known prompt' }],
      }),
      JSON.stringify({ type: 'future.event', time: 1_789_689_602_000 }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry(registryOptions(root, 'kimi')).get('kimi')!;

    const result = await adapter.scan();

    expect(result.traces).toHaveLength(2);
    const legacy = result.traces.find((trace) => trace.source.externalId === 'session-legacy');
    const future = result.traces.find((trace) => trace.source.externalId === 'session-future');
    expect(legacy).toMatchObject({
      messages: [],
      usage: { provenance: 'unavailable' },
      provenance: {
        completeness: 'partial',
        warnings: ['Kimi wire protocol 1.0 is metadata-only because its event contract is not verified.'],
      },
    });
    expect(future).toMatchObject({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'known prompt' }] }],
      usage: { provenance: 'unavailable' },
      provenance: {
        completeness: 'partial',
        warnings: [
          'Kimi wire protocol 2.0 is not a verified native contract.',
          'Kimi wire contains unsupported record type "future.event".',
        ],
      },
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Kimi wire protocol 1.0 is metadata-only because its event contract is not verified.',
      'Kimi wire protocol 2.0 is not a verified native contract.',
      'Kimi wire contains unsupported record type "future.event".',
    ]));
  });

  it('normalizes Antigravity transcripts with source minimization, tool pairing, and SDK usage', async () => {
    const root = await tempRoot();
    const brain = path.join(root, '.gemini', 'antigravity', 'brain');
    const sessionDirectory = path.join(
      brain,
      'antigravity-native',
      '.system_generated',
      'logs',
    );
    await fs.ensureDir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, 'transcript_full.jsonl'), [
      JSON.stringify({
        step_index: 4,
        type: 'ERROR_MESSAGE',
        status: 'FAILED',
        created_at: '2026-09-18T00:00:04.000Z',
        error: 'Command failed with exit code 1.',
      }),
      JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        created_at: '2026-09-18T00:00:01.000Z',
        content: [
          'private system scaffold',
          'Model Selection` changed to gemini-3.6-flash-medium. No need to mention it.',
          '<USER_REQUEST>Inspect the Antigravity project.</USER_REQUEST>',
        ].join('\n'),
      }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-09-18T00:00:02.000Z',
        thinking: 'Check the source and tests.',
        content: 'I will inspect the project.',
        tool_calls: [
          { name: 'view_file', args: { AbsolutePath: '/workspace/antigravity/src/index.ts' } },
          { name: 'run_command', args: { Cwd: '/workspace/antigravity', CommandLine: 'bun test' } },
        ],
        usage_metadata: {
          prompt_token_count: 100,
          cached_content_token_count: 40,
          candidates_token_count: 10,
          thoughts_token_count: 3,
          total_token_count: 113,
        },
      }),
      JSON.stringify({
        step_index: 3,
        type: 'VIEW_FILE',
        status: 'SUCCESS',
        created_at: '2026-09-18T00:00:03.000Z',
        content: 'source contents',
      }),
      JSON.stringify({
        step_index: 5,
        type: 'CHECKPOINT',
        created_at: '2026-09-18T00:00:05.000Z',
        content: '{{ CHECKPOINT 2 }}\nContext compacted.',
      }),
      JSON.stringify({
        step_index: 6,
        type: 'INVOKE_SUBAGENT',
        created_at: '2026-09-18T00:00:06.000Z',
        content: JSON.stringify({
          conversationId: 'antigravity-child',
          prompt: 'private subagent prompt',
        }),
      }),
      JSON.stringify({
        step_index: 7,
        type: 'SYSTEM_MESSAGE',
        content: 'private system message',
      }),
      JSON.stringify({
        step_index: 8,
        type: 'CONVERSATION_HISTORY',
        content: 'private conversation history',
      }),
      JSON.stringify({
        step_index: 9,
        type: 'KNOWLEDGE_ARTIFACTS',
        content: 'private knowledge artifacts',
      }),
      JSON.stringify({
        step_index: 10,
        type: 'FUTURE_STEP',
        content: 'private future payload',
      }),
    ].join('\n'));
    await fs.writeFile(path.join(sessionDirectory, 'transcript.jsonl'), JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>fallback transcript must not be read</USER_REQUEST>',
    }));
    await fs.writeFile(path.join(sessionDirectory, 'diagnostics.jsonl'), JSON.stringify({
      sessionId: 'diagnostic-decoy', messages: [{ role: 'user', content: 'must not be read' }],
    }));
    const legacyDirectory = path.join(root, '.gemini', 'antigravity', 'conversations');
    await fs.ensureDir(legacyDirectory);
    await fs.writeFile(path.join(legacyDirectory, 'legacy.pb'), 'legacy protobuf must not be read');
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
    }).get('antigravity')!;

    const result = await adapter.scan();

    expect(result.filesScanned).toBe(1);
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      id: createCanonicalTraceId('antigravity', 'antigravity-native', 'native-session-id'),
      source: { harness: 'antigravity', externalId: 'antigravity-native' },
      project: { path: '/workspace/antigravity' },
      startedAt: '2026-09-18T00:00:01.000Z',
      endedAt: '2026-09-18T00:00:06.000Z',
      status: 'unknown',
      model: 'gemini-3.6-flash-medium',
      usage: {
        input: 100,
        output: 10,
        reasoning: 3,
        cacheRead: 40,
        total: 113,
        provenance: 'actual',
      },
      relationships: [{
        type: 'child',
        traceId: createCanonicalTraceId('antigravity', 'antigravity-child', 'native-session-id'),
      }],
      provenance: {
        completeness: 'partial',
        warnings: ['Antigravity transcript contains unsupported record type "FUTURE_STEP".'],
      },
    });
    expect(result.traces[0].messages).toMatchObject([
      {
        sourceKey: 'step-1:user',
        role: 'user',
        parts: [{ type: 'text', text: 'Inspect the Antigravity project.' }],
      },
      {
        sourceKey: 'step-2:assistant',
        role: 'assistant',
        model: 'gemini-3.6-flash-medium',
        usage: {
          input: 100,
          output: 10,
          reasoning: 3,
          cacheRead: 40,
          total: 113,
          provenance: 'actual',
        },
        parts: [
          { type: 'reasoning', text: 'Check the source and tests.' },
          {
            type: 'tool_call',
            callId: 'call-2-1',
            name: 'view_file',
            arguments: { AbsolutePath: '/workspace/antigravity/src/index.ts' },
          },
          {
            type: 'tool_call',
            callId: 'call-2-2',
            name: 'run_command',
            arguments: { Cwd: '/workspace/antigravity', CommandLine: 'bun test' },
          },
          { type: 'text', text: 'I will inspect the project.' },
        ],
      },
      {
        sourceKey: 'step-3:tool-result',
        role: 'tool',
        parts: [{
          type: 'tool_result',
          callId: 'call-2-1',
          name: 'view_file',
          content: 'source contents',
        }],
      },
      {
        sourceKey: 'step-4:tool-result',
        role: 'tool',
        parts: [{
          type: 'tool_result',
          callId: 'call-2-2',
          name: 'run_command',
          content: 'Command failed with exit code 1.',
          isError: true,
        }],
      },
      {
        sourceKey: 'step-5:compaction',
        role: 'system',
        parts: [{ type: 'text', text: 'Context compacted.' }],
      },
    ]);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('Antigravity transcript contains unsupported record type "FUTURE_STEP".');
    const serialized = JSON.stringify(result.traces);
    expect(serialized).not.toContain('private system scaffold');
    expect(serialized).not.toContain('private subagent prompt');
    expect(serialized).not.toContain('private system message');
    expect(serialized).not.toContain('private conversation history');
    expect(serialized).not.toContain('private knowledge artifacts');
    expect(serialized).not.toContain('private future payload');
    expect(serialized).not.toContain('fallback transcript must not be read');
    expect(serialized).not.toContain('diagnostic-decoy');
  });

  it('uses the Antigravity transcript fallback and deduplicates copied native identities', async () => {
    const root = await tempRoot();
    const firstBrain = path.join(root, 'first', 'brain');
    const secondBrain = path.join(root, 'second', 'brain');
    const firstLog = path.join(
      firstBrain,
      'copied-antigravity',
      '.system_generated',
      'logs',
      'transcript.jsonl',
    );
    const secondLog = path.join(
      secondBrain,
      'copied-antigravity',
      '.system_generated',
      'logs',
      'transcript_full.jsonl',
    );
    await fs.ensureDir(path.dirname(firstLog));
    await fs.ensureDir(path.dirname(secondLog));
    await fs.writeFile(firstLog, JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      created_at: '2026-09-18T00:00:01.000Z',
      content: '<USER_REQUEST>First copy.</USER_REQUEST>',
    }));
    await fs.writeFile(secondLog, [
      JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        created_at: '2026-09-18T00:00:01.000Z',
        content: '<USER_REQUEST>First copy.</USER_REQUEST>',
      }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-09-18T00:00:02.000Z',
        content: 'Longer copy wins.',
      }),
    ].join('\n'));
    const adapter = createTraceSourceRegistry({
      homeDirectory: root,
      autohandHome: path.join(root, '.autohand'),
      environment: {},
      platform: process.platform,
      locationOverrides: { antigravity: [firstBrain, secondBrain] },
    }).get('antigravity')!;

    const result = await adapter.scan();

    expect(result).toMatchObject({ filesScanned: 2, truncated: false, warnings: [] });
    expect(result.sourceFiles).toHaveLength(2);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]).toMatchObject({
      id: createCanonicalTraceId('antigravity', 'copied-antigravity', 'native-session-id'),
      source: { externalId: 'copied-antigravity', recordPath: secondLog },
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'First copy.' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Longer copy wins.' }] },
      ],
    });
    expect(new Set(result.sourceFiles.flatMap((source) => source.traceIds))).toEqual(
      new Set([result.traces[0].id]),
    );
  });

  it.each<TraceHarness>([
    'pi', 'copilot', 'cline', 'openclaw', 'droid', 'grok', 'kimi',
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
    const sessionPath = harness === 'grok'
      ? path.join(root, 'workspace', 'session', 'summary.json')
      : path.join(root, `session.${extension}`);
    await fs.ensureDir(path.dirname(sessionPath));
    await fs.writeFile(sessionPath, JSON.stringify(record));

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
