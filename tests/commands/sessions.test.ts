/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { sessions } from '../../src/commands/sessions.js';
import { session } from '../../src/commands/session.js';
import type { SessionManager } from '../../src/session/SessionManager.js';
import type { SessionMetadata } from '../../src/session/types.js';

function meta(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: '63128e1e-9204-4d64-8f4b-62af1eeb50cc-1795571318924',
    createdAt: '2026-11-25T01:48:00.000Z',
    lastActiveAt: '2026-11-25T02:00:00.000Z',
    projectPath: '/work/app',
    projectName: 'app',
    model: 'fantail',
    messageCount: 4,
    status: 'completed',
    title: 'Fix peer messaging default',
    ...overrides,
  } as SessionMetadata;
}

function managerListing(list: SessionMetadata[] | Error): SessionManager {
  return {
    listSessions: vi.fn(async () => {
      if (list instanceof Error) throw list;
      return list;
    }),
  } as unknown as SessionManager;
}

/*
 * In full-screen mode console output is held (it would be painted over by the next frame), so a
 * command that prints instead of returning shows nothing at all. These commands return their text.
 */
describe('/sessions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the list instead of printing it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const output = await sessions({ sessionManager: managerListing([meta()]), args: [] });

    expect(log).not.toHaveBeenCalled();
    const text = stripAnsi(output ?? '');
    expect(text).toContain('Sessions');
    expect(text).toContain('63128e1e-9204-4d64-8f4b-62af1eeb50cc-1795571318924');
    expect(text).toContain('Fix peer messaging default');
    expect(text).toContain('/resume <id>');
  });

  it('keeps every column aligned when ids are longer than the old fixed width', async () => {
    const output = await sessions({
      sessionManager: managerListing([
        meta(),
        meta({ sessionId: 'short-id', title: 'Second', messageCount: 12 }),
      ]),
      args: [],
    });
    const rows = stripAnsi(output ?? '').split('\n');
    const header = rows.find((row) => row.includes('Messages'))!;
    const nameColumn = header.indexOf('Name');
    for (const title of ['Fix peer messaging default', 'Second']) {
      expect(rows.find((row) => row.includes(title))!.indexOf(title)).toBe(nameColumn);
    }
  });

  it('leaves out sessions with no messages and says when nothing is left', async () => {
    const output = await sessions({ sessionManager: managerListing([meta({ messageCount: 0 })]), args: [] });
    expect(stripAnsi(output ?? '')).toBe('No saved sessions found.');
  });

  it('shows the first 20 and counts the rest', async () => {
    const many = Array.from({ length: 23 }, (_, index) => meta({ sessionId: `session-${index}`, title: `Title ${index}` }));
    const text = stripAnsi((await sessions({ sessionManager: managerListing(many), args: [] })) ?? '');
    expect(text).toContain('Title 19');
    expect(text).not.toContain('Title 20');
    expect(text).toContain('... and 3 more sessions');
  });

  it('passes --project through and names it in the heading', async () => {
    const manager = managerListing([meta()]);
    const text = stripAnsi((await sessions({ sessionManager: manager, args: ['--project', '/work/app'] })) ?? '');
    expect(manager.listSessions).toHaveBeenCalledWith({ project: '/work/app' });
    expect(text).toContain('Sessions for /work/app');
  });

  it('returns the failure instead of printing it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const output = await sessions({ sessionManager: managerListing(new Error('index unreadable')), args: [] });
    expect(error).not.toHaveBeenCalled();
    expect(stripAnsi(output ?? '')).toBe('Failed to list sessions: index unreadable');
  });

  it('shows a missing name as "No name"', async () => {
    const text = stripAnsi((await sessions({ sessionManager: managerListing([meta({ title: undefined })]), args: [] })) ?? '');
    expect(text).toContain('No name');
  });
});

describe('/session', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the current session details instead of printing them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const current = { metadata: meta() };
    const output = await session({ sessionManager: { getCurrentSession: () => current } as unknown as SessionManager });

    expect(log).not.toHaveBeenCalled();
    const text = stripAnsi(output ?? '');
    expect(text).toContain('Current session');
    expect(text).toContain('ID: 63128e1e-9204-4d64-8f4b-62af1eeb50cc-1795571318924');
    expect(text).toContain('Name: Fix peer messaging default');
    expect(text).toContain('Project: /work/app');
    expect(text).toContain('Messages: 4');
  });

  it('says when there is no active session', async () => {
    const output = await session({ sessionManager: { getCurrentSession: () => null } as unknown as SessionManager });
    expect(stripAnsi(output ?? '')).toBe('No active session.');
  });
});
