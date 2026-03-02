/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// Mock fs-extra before importing anything that uses it
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    readJson: vi.fn(),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn(),
  },
}));

// Mock crypto for deterministic session IDs
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomUUID: vi.fn().mockReturnValue('test-uuid-0000-0000-000000000000'),
    },
  };
});

import fse from 'fs-extra';
import { ClaudeImporter } from '../../src/import/importers/ClaudeImporter.js';

const HOME = os.homedir();
const CLAUDE_HOME = path.join(HOME, '.claude');

describe('ClaudeImporter', () => {
  let importer: ClaudeImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new ClaudeImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "claude"', () => {
      expect(importer.name).toBe('claude');
    });

    it('should have displayName "Claude Code"', () => {
      expect(importer.displayName).toBe('Claude Code');
    });

    it('should have homePath "~/.claude"', () => {
      expect(importer.homePath).toBe('~/.claude');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.claude does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('claude');
      expect(result.available.size).toBe(0);
    });

    it('should count sessions from project directories', async () => {
      // ~/.claude exists
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        if (s === path.join(CLAUDE_HOME, 'skills')) return false;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return false;
        return false;
      });

      // projects/ has two project directories
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [
            { name: '-Users-me-project1', isDirectory: () => true, isFile: () => false },
            { name: '-Users-me-project2', isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        // project1 has 2 jsonl files + a memory dir
        if (s.includes('project1')) {
          return [
            { name: 'abc.jsonl', isDirectory: () => false, isFile: () => true },
            { name: 'def.jsonl', isDirectory: () => false, isFile: () => true },
            { name: 'memory', isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        // project2 has 1 jsonl file
        if (s.includes('project2')) {
          return [
            { name: 'ghi.jsonl', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = await importer.scan();
      expect(result.source).toBe('claude');

      const sessions = result.available.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.count).toBe(3); // 2 + 1
    });

    it('should detect settings when settings.json exists', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return false;
        if (s === path.join(CLAUDE_HOME, 'skills')) return false;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBe(1);
    });

    it('should detect skills when skills/ directory has files', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'skills')) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return false;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return false;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'skills')) {
          return [
            { name: 'skill1.md', isDirectory: () => false, isFile: () => true },
            { name: 'skill2.md', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = await importer.scan();
      const skills = result.available.get('skills');
      expect(skills).toBeDefined();
      expect(skills!.count).toBe(2);
    });

    it('should detect memory from project directories with CLAUDE.md or memory/', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        if (s === path.join(CLAUDE_HOME, 'skills')) return false;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return false;
        // memory subdir exists in project1
        if (s.includes('project1') && s.endsWith('memory')) return true;
        if (s.includes('project1') && s.endsWith('CLAUDE.md')) return false;
        if (s.includes('project2') && s.endsWith('memory')) return false;
        if (s.includes('project2') && s.endsWith('CLAUDE.md')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [
            { name: '-Users-me-project1', isDirectory: () => true, isFile: () => false },
            { name: '-Users-me-project2', isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        // Return no session files for these projects
        if (s.includes('project1') || s.includes('project2')) {
          return [] as any;
        }
        return [];
      });

      const result = await importer.scan();
      const memory = result.available.get('memory');
      expect(memory).toBeDefined();
      expect(memory!.count).toBe(2); // 2 projects with memory data
    });

    it('should not throw when projects directory is missing', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        return false;
      });

      const result = await importer.scan();
      expect(result.source).toBe('claude');
      // Should have no sessions since projects/ doesn't exist
      expect(result.available.has('sessions')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // import() – sessions
  // ---------------------------------------------------------------
  describe('import() - sessions', () => {
    const userEvent = JSON.stringify({
      type: 'user',
      sessionId: 'session-1',
      cwd: '/home/user/project',
      message: { role: 'user', content: 'hello world' },
      timestamp: '2026-02-23T09:55:26.927Z',
      uuid: 'uuid-1',
    });

    const assistantEvent = JSON.stringify({
      type: 'assistant',
      sessionId: 'session-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
        model: 'claude-opus-4-6',
        id: 'msg_id',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      timestamp: '2026-02-23T09:55:30.000Z',
    });

    const progressEvent = JSON.stringify({
      type: 'progress',
      sessionId: 'session-1',
      message: { role: 'assistant', content: '' },
      timestamp: '2026-02-23T09:55:28.000Z',
    });

    const metaEvent = JSON.stringify({
      type: 'user',
      sessionId: 'session-1',
      isMeta: true,
      message: { role: 'user', content: 'meta info' },
      timestamp: '2026-02-23T09:55:25.000Z',
    });

    const fileHistoryEvent = JSON.stringify({
      type: 'file-history-snapshot',
      sessionId: 'session-1',
      timestamp: '2026-02-23T09:55:29.000Z',
    });

    it('should import sessions from JSONL files', async () => {
      // Setup: projects dir with one project, one session file
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [
            { name: '-Users-me-project', isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        if (s.includes('-Users-me-project')) {
          return [
            { name: 'session1.jsonl', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const sessionContent = [userEvent, assistantEvent].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(sessionContent as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      expect(result.source).toBe('claude');
      expect(result.errors).toEqual([]);

      const sessions = result.imported.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.success).toBe(1);
      expect(sessions!.failed).toBe(0);
    });

    it('should skip progress, file-history-snapshot, and isMeta events', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes('-Users-me-proj')) {
          return [{ name: 's1.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const content = [userEvent, progressEvent, metaEvent, fileHistoryEvent, assistantEvent].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      expect(result.errors).toEqual([]);

      // Verify the written conversation only has 2 messages (user + assistant)
      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      expect(convCall).toBeDefined();
      const lines = String(convCall![1]).trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should extract content from assistant array format', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes('-Users-me-proj')) {
          return [{ name: 's1.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const multiTextAssistant = JSON.stringify({
        type: 'assistant',
        sessionId: 'session-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part 1. ' },
            { type: 'tool_use', name: 'some_tool' },
            { type: 'text', text: 'Part 2.' },
          ],
          model: 'claude-opus-4-6',
        },
        timestamp: '2026-02-23T10:00:00.000Z',
      });

      const content = [userEvent, multiTextAssistant].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      const lines = String(convCall![1]).trim().split('\n');
      const assistantMsg = JSON.parse(lines[1]);
      expect(assistantMsg.content).toBe('Part 1. Part 2.');
    });

    it('should handle string content for user messages', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes('-Users-me-proj')) {
          return [{ name: 's1.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const content = [userEvent, assistantEvent].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      const lines = String(convCall![1]).trim().split('\n');
      const userMsg = JSON.parse(lines[0]);
      expect(userMsg.content).toBe('hello world');
      expect(userMsg.role).toBe('user');
    });

    it('should group events by sessionId when multiple sessions exist in one file', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes('-Users-me-proj')) {
          return [{ name: 's1.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const event1 = JSON.stringify({
        type: 'user', sessionId: 'sess-a', cwd: '/proj',
        message: { role: 'user', content: 'msg a' },
        timestamp: '2026-01-01T00:00:00Z',
      });
      const event2 = JSON.stringify({
        type: 'user', sessionId: 'sess-b', cwd: '/proj',
        message: { role: 'user', content: 'msg b' },
        timestamp: '2026-01-01T00:01:00Z',
      });
      const event3 = JSON.stringify({
        type: 'assistant', sessionId: 'sess-a',
        message: { role: 'assistant', content: 'reply a', model: 'claude-opus-4-6' },
        timestamp: '2026-01-01T00:00:30Z',
      });

      vi.mocked(fse.readFile).mockResolvedValue([event1, event2, event3].join('\n') as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      const sessions = result.imported.get('sessions');
      // Should create 2 sessions (sess-a with 2 msgs, sess-b with 1 msg)
      expect(sessions!.success).toBe(2);
    });

    it('should not throw on malformed JSONL lines', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes('-Users-me-proj')) {
          return [{ name: 's1.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const content = ['{BROKEN JSON', userEvent, assistantEvent].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      // Should still import the valid events
      expect(result.imported.get('sessions')!.success).toBe(1);
    });

    it('should handle empty project directory gracefully', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-proj', isDirectory: () => true, isFile: () => false }] as any;
        }
        // empty project
        return [];
      });

      const result = await importer.import(['sessions']);
      expect(result.errors).toEqual([]);
      const sessions = result.imported.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.success).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Summary generation (system content stripping)
  // ---------------------------------------------------------------
  describe('summary generation', () => {
    function setupOneSession(projectDir: string, jsonlContent: string) {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: projectDir, isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.includes(projectDir)) {
          return [{ name: 'session.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      vi.mocked(fse.readFile).mockResolvedValue(jsonlContent as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
    }

    it('should strip <system-reminder> tags from summary', async () => {
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '<system-reminder>Some system info</system-reminder>add dark mode support' } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: 'Sure!', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      expect(metadataCall).toBeDefined();
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.summary).toBe('add dark mode support');
    });

    it('should strip <local-command-caveat> tags from summary', async () => {
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '<local-command-caveat>Caveat about commands</local-command-caveat>fix the login page' } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: 'On it!', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.summary).toBe('fix the login page');
    });

    it('should skip to next user message when first is only system content', async () => {
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '<system-reminder>Full system prompt only</system-reminder>' } }),
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: 'build a REST API' } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:02Z', message: { role: 'assistant', content: 'Sure!', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.summary).toBe('build a REST API');
    });

    it('should strip multiple system tags from a single message', async () => {
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '<system-reminder>info</system-reminder><bash-input>pwd</bash-input><bash-stdout>/home</bash-stdout>update the config parser' } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: 'Done!', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.summary).toBe('update the config parser');
    });

    it('should fall back to "Imported Claude session" when all user content is system tags', async () => {
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '<system-reminder>All system</system-reminder><context>Only context</context>' } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: 'Hmm.', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.summary).toBe('Imported Claude session');
    });

    it('should truncate long summaries to 100 characters with ellipsis', async () => {
      const longText = 'a'.repeat(150);
      const events = [
        JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: longText } }),
        JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: 'OK', model: 'claude' } }),
      ].join('\n');

      setupOneSession('-Users-me-project', events);
      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call => String(call[0]).endsWith('metadata.json'));
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect((metadata.summary as string).length).toBe(103); // 100 + "..."
      expect((metadata.summary as string).endsWith('...')).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // import() – settings
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should import settings from settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'settings.json')) {
          return JSON.stringify({
            env: {},
            permissions: {
              allow: ['Read', 'Write', 'Bash(git:*)'],
            },
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      const settings = result.imported.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.success).toBe(1);
      expect(settings!.failed).toBe(0);
    });

    it('should handle missing settings.json gracefully', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      const settings = result.imported.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – skills
  // ---------------------------------------------------------------
  describe('import() - skills', () => {
    it('should copy skills from ~/.claude/skills/', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'skills')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'skills')) {
          return [
            { name: 'skill1.md', isDirectory: () => false, isFile: () => true },
            { name: 'skill2.md', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = await importer.import(['skills']);
      const skills = result.imported.get('skills');
      expect(skills).toBeDefined();
      expect(skills!.success).toBe(2);
      expect(fse.copy).toHaveBeenCalledTimes(2);
    });

    it('should handle missing skills directory gracefully', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['skills']);
      const skills = result.imported.get('skills');
      expect(skills).toBeDefined();
      expect(skills!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – memory
  // ---------------------------------------------------------------
  describe('import() - memory', () => {
    it('should copy memory data from project directories', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return true;
        if (s.includes('project1') && s.endsWith('memory')) return true;
        if (s.includes('project1') && s.endsWith('CLAUDE.md')) return false;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CLAUDE_HOME, 'projects')) {
          return [{ name: '-Users-me-project1', isDirectory: () => true, isFile: () => false }] as any;
        }
        // Return no session files for this project
        if (s.includes('project1')) {
          return [{ name: 'memory', isDirectory: () => true, isFile: () => false }] as any;
        }
        return [];
      });

      const result = await importer.import(['memory']);
      const memory = result.imported.get('memory');
      expect(memory).toBeDefined();
      expect(memory!.success).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – multiple categories
  // ---------------------------------------------------------------
  describe('import() - multiple categories', () => {
    it('should import only requested categories', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return true;
        if (s === path.join(CLAUDE_HOME, 'projects')) return false;
        if (s === path.join(CLAUDE_HOME, 'skills')) return false;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({ permissions: { allow: [] } }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      // Only settings should be imported
      expect(result.imported.has('settings')).toBe(true);
      // Sessions should not be imported since we didn't request it
      expect(result.imported.has('sessions')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // import() – progress callback
  // ---------------------------------------------------------------
  describe('import() - progress callback', () => {
    it('should call progress callback during import', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLAUDE_HOME) return true;
        if (s === path.join(CLAUDE_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({ permissions: { allow: [] } }) as never;
        }
        throw new Error('not found');
      });

      const onProgress = vi.fn();
      await importer.import(['settings'], onProgress);

      expect(onProgress).toHaveBeenCalled();
      const calls = onProgress.mock.calls;
      expect(calls.some((c: any[]) => c[0].category === 'settings')).toBe(true);
    });
  });
});
