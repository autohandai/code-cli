/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    ensureFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  },
}));

import fs from 'fs-extra';
import { aliasMetadata, bug, metadata, type BugCommandContext } from '../../src/commands/bug.js';
import type { GitHubIdentity } from '../../src/feedback/githubIdentity.js';
import type { SessionMessage } from '../../src/session/types.js';

const mockedFs = vi.mocked(fs);

const CONVERSATION: SessionMessage[] = [
  { role: 'user', content: 'apply the patch', timestamp: '2026-10-03T10:00:00.000Z' },
  { role: 'assistant', content: '', timestamp: '2026-10-03T10:00:02.000Z', toolCalls: [{ function: { name: 'apply_patch' } }] },
  { role: 'tool', content: 'error: hunk failed', timestamp: '2026-10-03T10:00:03.000Z', name: 'apply_patch' },
];

function context(overrides: Partial<BugCommandContext> = {}): BugCommandContext {
  return {
    workspaceRoot: '/workspace',
    model: 'moa',
    provider: 'autohandai',
    currentSession: { metadata: { sessionId: 'session-7' }, getMessages: () => CONVERSATION } as BugCommandContext['currentSession'],
    resolveGitHubIdentity: async (): Promise<GitHubIdentity | null> => ({ login: 'octocat', source: 'gh' }),
    ...overrides,
  };
}

describe('bug command', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  const sentPayload = () => JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as Record<string, any>;
  const issueCreated = () => mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, id: 'report-1', issueUrl: 'https://github.com/autohandai/code-cli/issues/501', issueNumber: 501 }),
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof global.fetch;
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__autohandLastError;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('is reachable as /bug and /bug-report', () => {
    expect(metadata).toMatchObject({ command: '/bug', implemented: true });
    expect(aliasMetadata).toMatchObject({ command: '/bug-report', implemented: true });
  });

  it('files a user bug report with the description, environment, transcript and GitHub login', async () => {
    issueCreated();

    const result = await bug(context(), ['patches', 'fail', 'on', 'CRLF', 'files']);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.autohand.ai/v1/reports');
    const payload = sentPayload();
    expect(payload).toMatchObject({
      reportKind: 'user',
      errorType: 'user_bug_report',
      errorMessage: 'patches fail on CRLF files',
      model: 'moa',
      provider: 'autohandai',
      sessionId: 'session-7',
      conversationLength: 3,
      lastToolCalls: ['apply_patch'],
      reporter: { githubLogin: 'octocat', githubSource: 'gh' },
      transcript: { sessionId: 'session-7', messageCount: 3, truncated: false },
      platform: process.platform,
      cliVersion: expect.any(String),
      deviceId: expect.any(String),
    });
    expect(payload.transcript.messages).toHaveLength(3);
    expect(payload.environment).toEqual(expect.objectContaining({ os: expect.any(String), runtime: expect.any(String), provider: 'autohandai', model: 'moa' }));
    expect(result).toContain('https://github.com/autohandai/code-cli/issues/501');
    expect(result).toContain('@octocat');
  });

  it('sends the Autohand account id privately when the user is signed in', async () => {
    issueCreated();
    const config = { auth: { user: { id: 'user-123', email: 'mona@example.com', name: 'Mona' } } } as BugCommandContext['config'];

    await bug(context({ config }), ['the', 'status', 'line', 'wraps']);

    const body = mockFetch.mock.calls[0]?.[1]?.body as string;
    expect(sentPayload().reporter).toEqual({ githubLogin: 'octocat', githubSource: 'gh', accountId: 'user-123' });
    expect(body).not.toContain('mona@example.com');
  });

  it('files without a login when no GitHub identity can be determined', async () => {
    issueCreated();

    const result = await bug(context({ resolveGitHubIdentity: async () => null }), ['composer', 'loses', 'focus']);

    expect(sentPayload()).not.toHaveProperty('reporter');
    expect(result).toContain('https://github.com/autohandai/code-cli/issues/501');
    expect(result).not.toContain('@');
  });

  it.each(['--anonymous', '--anon'])('skips the identity lookup entirely with %s', async (flag) => {
    issueCreated();
    const resolveGitHubIdentity = vi.fn(async () => ({ login: 'octocat', source: 'gh' as const }));
    const config = { auth: { user: { id: 'user-123' } } } as BugCommandContext['config'];

    await bug(context({ resolveGitHubIdentity, config }), [flag, 'scrollback', 'is', 'cleared']);

    expect(resolveGitHubIdentity).not.toHaveBeenCalled();
    expect(sentPayload().errorMessage).toBe('scrollback is cleared');
    expect(sentPayload()).not.toHaveProperty('reporter');
  });

  it('redacts secrets from the description and the transcript', async () => {
    issueCreated();
    const currentSession = {
      metadata: { sessionId: 'session-7' },
      getMessages: () => [{ role: 'tool', content: 'Authorization: Bearer abc.def.ghi-123', timestamp: 't', name: 'run_command' }],
    } as BugCommandContext['currentSession'];

    await bug(context({ currentSession }), ['fails', 'with', 'sk-abcdefghijklmnop1234', 'set']);

    const body = mockFetch.mock.calls[0]?.[1]?.body as string;
    expect(body).not.toContain('sk-abcdefghijklmnop1234');
    expect(body).not.toContain('abc.def.ghi-123');
  });

  it('includes the last runtime error as the stack', async () => {
    issueCreated();
    (globalThis as Record<string, unknown>).__autohandLastError = new Error('ENOENT: no such file');

    await bug(context(), ['crashed', 'after', 'resume']);

    expect(sentPayload().sanitizedStack).toContain('ENOENT: no such file');
  });

  it('works before any conversation exists', async () => {
    issueCreated();

    await bug(context({ currentSession: undefined }), ['startup', 'banner', 'is', 'misaligned']);

    const payload = sentPayload();
    expect(payload).not.toHaveProperty('transcript');
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload.conversationLength).toBe(0);
  });

  it.each([[[]], [['--anonymous']], [['short']]])('asks for a description instead of filing %j', async (args) => {
    const result = await bug(context(), args);

    expect(result).toContain('Usage: /bug <what went wrong>');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns immediately and reports the issue link through notifyUser', async () => {
    let respond!: (value: unknown) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const notifyUser = vi.fn();

    const result = await bug(context({ notifyUser }), ['undo', 'restores', 'the', 'wrong', 'file']);

    expect(result).toContain('Filing your bug report');
    expect(notifyUser).not.toHaveBeenCalled();

    respond({ ok: true, json: async () => ({ success: true, issueUrl: 'https://github.com/autohandai/code-cli/issues/502', issueNumber: 502 }) });
    await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledOnce());
    expect(notifyUser.mock.calls[0]?.[0]).toContain('issues/502');
  });

  it('says so when an identical report was already filed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, deduplicated: true, issueUrl: 'https://github.com/autohandai/code-cli/issues/77', issueNumber: 77 }),
    });

    const result = await bug(context(), ['same', 'bug', 'as', 'before']);

    expect(result).toContain('already');
    expect(result).toContain('issues/77');
  });

  it('keeps a local copy and explains a failed submission', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, text: async () => 'Bad Gateway' });

    const result = await bug(context(), ['nothing', 'gets', 'through']);

    expect(result).toContain('could not be sent');
    expect(result).toContain('HTTP 502');
    expect(mockedFs.appendFile).toHaveBeenCalledOnce();
    const line = mockedFs.appendFile.mock.calls[0]?.[1] as string;
    expect(JSON.parse(line)).toMatchObject({ errorMessage: 'nothing gets through', transcript: { messageCount: 3 } });
    expect(line).not.toContain('apply the patch');
  });

  it('survives an identity lookup that throws', async () => {
    issueCreated();
    const resolveGitHubIdentity = async () => {
      throw new Error('gh exploded');
    };

    const result = await bug(context({ resolveGitHubIdentity }), ['still', 'gets', 'filed']);

    expect(result).toContain('issues/501');
    expect(sentPayload()).not.toHaveProperty('reporter');
  });

  it('survives a network failure in the background without an unhandled rejection', async () => {
    mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const notifyUser = vi.fn();

    await bug(context({ notifyUser }), ['offline', 'bug', 'report']);

    await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledOnce());
    expect(notifyUser.mock.calls[0]?.[0]).toContain('could not be sent');
  });
});
