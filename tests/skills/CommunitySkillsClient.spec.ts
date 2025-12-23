/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { CommunitySkillsClient } from '../../src/skills/CommunitySkillsClient.js';
import type { ProjectAnalysis } from '../../src/skills/autoSkill.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CommunitySkillsClient', () => {
  const tempRoot = path.join(os.tmpdir(), `community-skills-test-${Date.now()}`);
  let client: CommunitySkillsClient;

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  beforeEach(() => {
    mockFetch.mockReset();
    client = new CommunitySkillsClient({
      apiBaseUrl: 'https://api.autohand.ai',
      enabled: true,
      deviceId: 'test-device-id',
      queueDir: path.join(tempRoot, 'queue'),
    });
  });

  describe('listSkills', () => {
    it('returns paginated results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 2,
          skills: [
            { id: '1', name: 'skill-one', description: 'First skill', downloadCount: 100 },
            { id: '2', name: 'skill-two', description: 'Second skill', downloadCount: 50 },
          ],
        }),
      });

      const result = await client.listSkills();

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('skill-one');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/community-skills'),
        expect.any(Object)
      );
    });

    it('applies language filters correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 1,
          skills: [{ id: '1', name: 'ts-skill', languages: ['typescript'] }],
        }),
      });

      await client.listSkills({ languages: ['typescript'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('languages=typescript'),
        expect.any(Object)
      );
    });

    it('applies framework filters correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 1,
          skills: [{ id: '1', name: 'react-skill', frameworks: ['react'] }],
        }),
      });

      await client.listSkills({ frameworks: ['react', 'nextjs'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('frameworks=react%2Cnextjs'),
        expect.any(Object)
      );
    });

    it('returns empty array when offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.listSkills();

      expect(result).toEqual([]);
    });
  });

  describe('downloadSkill', () => {
    it('downloads and returns skill content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          skill: {
            name: 'test-skill',
            description: 'A test skill',
            body: '# Test Skill\n\nThis is a test.',
            allowedTools: 'read_file write_file',
          },
        }),
      });

      const result = await client.downloadSkill('test-skill');

      expect(result.success).toBe(true);
      expect(result.skill?.name).toBe('test-skill');
      expect(result.skill?.body).toContain('Test Skill');
    });

    it('returns error for non-existent skill', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Skill not found' }),
      });

      const result = await client.downloadSkill('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Skill not found');
    });
  });

  describe('getSuggestions', () => {
    it('returns relevant skills for project analysis', async () => {
      const analysis: ProjectAnalysis = {
        projectName: 'my-project',
        languages: ['typescript'],
        frameworks: ['react'],
        patterns: ['testing'],
        dependencies: [],
        filePatterns: [],
        platform: 'darwin',
        hasGit: true,
        hasTests: true,
        hasCI: false,
        packageManager: 'npm',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 2,
          suggestions: [
            {
              skill: { id: '1', name: 'react-components', description: 'React component helper' },
              relevanceScore: 85,
              matchReason: 'Languages: typescript; Frameworks: react',
            },
            {
              skill: { id: '2', name: 'test-generator', description: 'Generate tests' },
              relevanceScore: 60,
              matchReason: 'Patterns: testing',
            },
          ],
        }),
      });

      const result = await client.getSuggestions(analysis);

      expect(result.length).toBe(2);
      expect(result[0].skill.name).toBe('react-components');
      expect(result[0].relevanceScore).toBe(85);
    });

    it('returns empty array when no matches', async () => {
      const analysis: ProjectAnalysis = {
        projectName: 'empty',
        languages: [],
        frameworks: [],
        patterns: [],
        dependencies: [],
        filePatterns: [],
        platform: 'darwin',
        hasGit: false,
        hasTests: false,
        hasCI: false,
        packageManager: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 0,
          suggestions: [],
          message: 'No project context provided',
        }),
      });

      const result = await client.getSuggestions(analysis);

      expect(result).toEqual([]);
    });
  });

  describe('backupSkill', () => {
    it('uploads skill to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          backed: 1,
          skipped: 0,
        }),
      });

      const result = await client.backupSkill({
        name: 'my-skill',
        description: 'My custom skill',
        body: '# My Skill\n\nContent here.',
        originalSource: 'autohand-user',
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/skills-backup'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('queues backup when offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.backupSkill({
        name: 'offline-skill',
        description: 'Queued skill',
        body: '# Offline\n\nWill sync later.',
        originalSource: 'claude-user',
      });

      // Should return false but queue the operation
      expect(result).toBe(false);
      expect(client.getQueueStatus().pending).toBeGreaterThan(0);
    });
  });

  describe('listBackups', () => {
    it('returns backed up skills for device', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 2,
          backups: [
            { name: 'backup-one', description: 'First backup', originalSource: 'codex-user' },
            { name: 'backup-two', description: 'Second backup', originalSource: 'claude-user' },
          ],
        }),
      });

      const result = await client.listBackups();

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('backup-one');
    });
  });

  describe('restoreBackups', () => {
    it('fetches and returns restorable skills', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          count: 1,
          skills: [
            {
              name: 'restored-skill',
              description: 'Restored from backup',
              body: '# Restored\n\nContent.',
              originalSource: 'autohand-user',
            },
          ],
        }),
      });

      const result = await client.restoreBackups();

      expect(result.count).toBe(1);
      expect(result.skills[0].name).toBe('restored-skill');
    });
  });

  describe('submitSkill', () => {
    it('submits skill for review', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          id: 'new-skill-id',
          pending: true,
          message: 'Skill submitted for review',
        }),
      });

      const result = await client.submitSkill({
        name: 'new-skill',
        description: 'A new community skill',
        body: '# New Skill\n\nNew content.',
      });

      expect(result.success).toBe(true);
      expect(result.pending).toBe(true);
    });

    it('handles duplicate name error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          error: 'Skill name already exists',
        }),
      });

      const result = await client.submitSkill({
        name: 'existing-skill',
        description: 'Duplicate',
        body: '# Duplicate',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Skill name already exists');
    });
  });

  describe('offline queue', () => {
    it('persists queue to disk', async () => {
      // Use separate queue dir for this test
      const persistQueueDir = path.join(tempRoot, 'persist-queue');
      const persistClient = new CommunitySkillsClient({
        apiBaseUrl: 'https://api.autohand.ai',
        enabled: true,
        deviceId: 'test-device-id',
        queueDir: persistQueueDir,
      });

      mockFetch.mockRejectedValue(new Error('Network error'));

      await persistClient.backupSkill({
        name: 'queued-skill',
        description: 'Queued',
        body: '# Queued',
        originalSource: 'test',
      });

      // Create new client to verify queue persisted
      const newClient = new CommunitySkillsClient({
        apiBaseUrl: 'https://api.autohand.ai',
        enabled: true,
        deviceId: 'test-device-id',
        queueDir: persistQueueDir,
      });

      expect(newClient.getQueueStatus().pending).toBeGreaterThan(0);
    });

    it('flushes queue when online', async () => {
      // Use separate queue dir for this test
      const flushQueueDir = path.join(tempRoot, 'flush-queue');
      const flushClient = new CommunitySkillsClient({
        apiBaseUrl: 'https://api.autohand.ai',
        enabled: true,
        deviceId: 'test-device-id',
        queueDir: flushQueueDir,
      });

      // First call fails (queued)
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await flushClient.backupSkill({
        name: 'flush-skill',
        description: 'To flush',
        body: '# Flush',
        originalSource: 'test',
      });

      expect(flushClient.getQueueStatus().pending).toBe(1);

      // Now succeed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, backed: 1, skipped: 0 }),
      });

      const flushed = await flushClient.flushQueue();

      expect(flushed.sent).toBe(1);
      expect(flushClient.getQueueStatus().pending).toBe(0);
    });
  });

  describe('disabled client', () => {
    it('returns empty results when disabled', async () => {
      const disabledClient = new CommunitySkillsClient({
        apiBaseUrl: 'https://api.autohand.ai',
        enabled: false,
        deviceId: 'test-device-id',
      });

      const skills = await disabledClient.listSkills();
      expect(skills).toEqual([]);

      const backups = await disabledClient.listBackups();
      expect(backups).toEqual([]);
    });
  });
});
