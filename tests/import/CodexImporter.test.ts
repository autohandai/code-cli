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
      randomUUID: vi.fn().mockReturnValue('test-uuid-1111-1111-111111111111'),
    },
  };
});

import fse from 'fs-extra';
import { CodexImporter } from '../../src/import/importers/CodexImporter.js';

const HOME = os.homedir();
const CODEX_HOME = path.join(HOME, '.codex');

describe('CodexImporter', () => {
  let importer: CodexImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new CodexImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "codex"', () => {
      expect(importer.name).toBe('codex');
    });

    it('should have displayName "OpenAI Codex"', () => {
      expect(importer.displayName).toBe('OpenAI Codex');
    });

    it('should have homePath "~/.codex"', () => {
      expect(importer.homePath).toBe('~/.codex');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.codex does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('codex');
      expect(result.available.size).toBe(0);
    });

    it('should count sessions from recursive session directory walk', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'sessions')) return true;
        if (s === path.join(CODEX_HOME, 'config.toml')) return false;
        if (s === path.join(CODEX_HOME, 'skills')) return false;
        if (s === path.join(CODEX_HOME, 'rules')) return false;
        return false;
      });

      // sessions/ -> 2026/ -> 03/ -> 01/ -> two .jsonl files
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CODEX_HOME, 'sessions')) {
          return [{ name: '2026', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('2026')) {
          return [{ name: '03', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('03')) {
          return [{ name: '01', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('01')) {
          return [
            { name: 'rollout-2026-03-01T06-44-20-uuid1.jsonl', isDirectory: () => false, isFile: () => true },
            { name: 'rollout-2026-03-01T07-00-00-uuid2.jsonl', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = await importer.scan();
      const sessions = result.available.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.count).toBe(2);
    });

    it('should detect config.toml as settings', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'config.toml')) return true;
        if (s === path.join(CODEX_HOME, 'sessions')) return false;
        if (s === path.join(CODEX_HOME, 'skills')) return false;
        if (s === path.join(CODEX_HOME, 'rules')) return false;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBe(1);
    });

    it('should detect skills directory', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'skills')) return true;
        if (s === path.join(CODEX_HOME, 'sessions')) return false;
        if (s === path.join(CODEX_HOME, 'config.toml')) return false;
        if (s === path.join(CODEX_HOME, 'rules')) return false;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CODEX_HOME, 'skills')) {
          return [
            { name: 'skill1.md', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = await importer.scan();
      const skills = result.available.get('skills');
      expect(skills).toBeDefined();
      expect(skills!.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – sessions
  // ---------------------------------------------------------------
  describe('import() - sessions', () => {
    const sessionMeta = JSON.stringify({
      timestamp: '2026-02-28T17:44:20.058Z',
      type: 'session_meta',
      payload: {
        id: 'session-uuid-1',
        timestamp: '2026-02-28T17:44:20.058Z',
        cwd: '/home/user/project',
        originator: 'codex_exec',
        cli_version: '0.45.0',
        instructions: null,
      },
    });

    const userMessage = JSON.stringify({
      timestamp: '2026-02-28T17:44:25.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello codex' }],
      },
    });

    const assistantMessage = JSON.stringify({
      timestamp: '2026-02-28T17:44:30.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hey! What can I help you with?' }],
      },
    });

    const agentMessage = JSON.stringify({
      timestamp: '2026-02-28T17:44:32.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Analyzing your code...' },
    });

    const turnContextEvent = JSON.stringify({
      timestamp: '2026-02-28T17:44:22.000Z',
      type: 'turn_context',
      payload: { type: 'something', data: {} },
    });

    const tokenCountEvent = JSON.stringify({
      timestamp: '2026-02-28T17:44:33.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', input: 100, output: 50 },
    });

    function setupSessionDir() {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'sessions')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CODEX_HOME, 'sessions')) {
          return [{ name: '2026', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('2026')) {
          return [{ name: '03', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('03')) {
          return [{ name: '01', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('01')) {
          return [{ name: 'rollout.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });
    }

    it('should import sessions from JSONL files', async () => {
      setupSessionDir();

      const content = [sessionMeta, userMessage, assistantMessage].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      expect(result.source).toBe('codex');
      expect(result.errors).toEqual([]);

      const sessions = result.imported.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.success).toBe(1);
    });

    it('should extract user and assistant messages from response_item events', async () => {
      setupSessionDir();

      const content = [sessionMeta, userMessage, assistantMessage].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      expect(convCall).toBeDefined();
      const lines = String(convCall![1]).trim().split('\n');
      expect(lines).toHaveLength(2);

      const userMsg = JSON.parse(lines[0]);
      expect(userMsg.role).toBe('user');
      expect(userMsg.content).toBe('hello codex');

      const assistantMsg = JSON.parse(lines[1]);
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Hey! What can I help you with?');
    });

    it('should extract agent_message events as assistant messages', async () => {
      setupSessionDir();

      const content = [sessionMeta, userMessage, agentMessage].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      const lines = String(convCall![1]).trim().split('\n');
      expect(lines).toHaveLength(2);

      const agentMsg = JSON.parse(lines[1]);
      expect(agentMsg.role).toBe('assistant');
      expect(agentMsg.content).toBe('Analyzing your code...');
    });

    it('should skip turn_context and token_count events', async () => {
      setupSessionDir();

      const content = [
        sessionMeta, turnContextEvent, tokenCountEvent, userMessage, assistantMessage,
      ].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        String(call[0]).endsWith('conversation.jsonl'),
      );
      const lines = String(convCall![1]).trim().split('\n');
      // Only user + assistant messages, no turn_context or token_count
      expect(lines).toHaveLength(2);
    });

    it('should use cwd from session_meta as projectPath', async () => {
      setupSessionDir();

      const content = [sessionMeta, userMessage, assistantMessage].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      await importer.import(['sessions']);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        String(call[0]).endsWith('metadata.json'),
      );
      expect(metadataCall).toBeDefined();
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.projectPath).toBe('/home/user/project');
    });

    it('should handle empty session file gracefully', async () => {
      setupSessionDir();

      vi.mocked(fse.readFile).mockResolvedValue('' as never);

      const result = await importer.import(['sessions']);
      expect(result.errors).toEqual([]);
      expect(result.imported.get('sessions')!.skipped).toBeGreaterThanOrEqual(0);
    });

    it('should handle malformed JSONL lines gracefully', async () => {
      setupSessionDir();

      const content = ['{BROKEN', sessionMeta, userMessage, assistantMessage].join('\n');
      vi.mocked(fse.readFile).mockResolvedValue(content as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const result = await importer.import(['sessions']);
      // Should still import the valid messages
      expect(result.imported.get('sessions')!.success).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – settings (TOML parsing)
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should parse simple TOML config', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'config.toml')) return true;
        return false;
      });

      const tomlContent = [
        '# Codex config',
        'model = "o4-mini"',
        'model_reasoning_effort = "high"',
        '',
        '[provider]',
        'api_key = "sk-..."',
        'base_url = "https://api.openai.com/v1"',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(tomlContent as never);

      const result = await importer.import(['settings']);
      const settings = result.imported.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.success).toBe(1);

      // Verify it wrote the parsed config
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const configCall = writeJsonCalls.find(call =>
        String(call[0]).includes('imported-codex-settings'),
      );
      expect(configCall).toBeDefined();
      const written = configCall![1] as Record<string, unknown>;
      expect(written.importedFrom).toBe('codex');
      const parsed = written.parsed as Record<string, unknown>;
      expect(parsed.model).toBe('o4-mini');
      expect(parsed.model_reasoning_effort).toBe('high');
    });

    it('should handle TOML with section headers', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'config.toml')) return true;
        return false;
      });

      const tomlContent = [
        '[section]',
        'key = "value"',
        '',
        '[section.subsection]',
        'nested_key = "nested_value"',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(tomlContent as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
    });

    it('should handle missing config.toml gracefully', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      const settings = result.imported.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.skipped).toBe(1);
    });

    it('should handle unquoted values in TOML', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'config.toml')) return true;
        return false;
      });

      const tomlContent = [
        'timeout = 30',
        'enabled = true',
        'name = unquoted_string',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(tomlContent as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – skills
  // ---------------------------------------------------------------
  describe('import() - skills', () => {
    it('should copy skills from ~/.codex/skills/', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'skills')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CODEX_HOME, 'skills')) {
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

    it('should handle missing skills directory', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['skills']);
      expect(result.imported.get('skills')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – progress callback
  // ---------------------------------------------------------------
  describe('import() - progress callback', () => {
    it('should call progress callback during session import', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CODEX_HOME) return true;
        if (s === path.join(CODEX_HOME, 'sessions')) return true;
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(CODEX_HOME, 'sessions')) {
          return [{ name: '2026', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('2026')) {
          return [{ name: '01', isDirectory: () => true, isFile: () => false }] as any;
        }
        if (s.endsWith('01')) {
          return [{ name: 'rollout.jsonl', isDirectory: () => false, isFile: () => true }] as any;
        }
        return [];
      });

      const sessionContent = JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      });
      vi.mocked(fse.readFile).mockResolvedValue(sessionContent as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);

      const onProgress = vi.fn();
      await importer.import(['sessions'], onProgress);

      expect(onProgress).toHaveBeenCalled();
      const calls = onProgress.mock.calls;
      expect(calls.some((c: any[]) => c[0].category === 'sessions')).toBe(true);
    });
  });
});
