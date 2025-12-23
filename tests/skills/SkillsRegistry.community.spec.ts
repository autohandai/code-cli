/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { CommunitySkillsClient } from '../../src/skills/CommunitySkillsClient.js';
import type { CommunitySkillPackage } from '../../src/skills/CommunitySkillsClient.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SkillsRegistry Community Integration', () => {
  const tempRoot = path.join(os.tmpdir(), `skills-registry-community-${Date.now()}`);
  const userSkillsDir = path.join(tempRoot, 'user-skills');
  const workspaceDir = path.join(tempRoot, 'workspace');
  let registry: SkillsRegistry;
  let communityClient: CommunitySkillsClient;

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
    await fs.ensureDir(userSkillsDir);
    await fs.ensureDir(workspaceDir);
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  beforeEach(async () => {
    mockFetch.mockReset();
    registry = new SkillsRegistry(userSkillsDir, 'autohand-user');
    communityClient = new CommunitySkillsClient({
      apiBaseUrl: 'https://api.autohand.ai',
      enabled: true,
      deviceId: 'test-device-id',
      queueDir: path.join(tempRoot, 'queue'),
    });

    // Clean up workspace for each test
    await fs.emptyDir(workspaceDir);
    await fs.emptyDir(userSkillsDir);
  });

  describe('setCommunityClient', () => {
    it('sets the community client', () => {
      registry.setCommunityClient(communityClient);
      expect(registry.getCommunityClient()).toBe(communityClient);
    });

    it('allows null to disable community features', () => {
      registry.setCommunityClient(communityClient);
      registry.setCommunityClient(null);
      expect(registry.getCommunityClient()).toBeNull();
    });
  });

  describe('hasVendorSkills', () => {
    it('returns false when no skills are loaded', async () => {
      await registry.initialize();
      expect(registry.hasVendorSkills()).toBe(false);
    });

    it('returns true when codex-user skills exist', async () => {
      // Create a codex skill
      const codexDir = path.join(userSkillsDir, 'codex-skill');
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, 'SKILL.md'),
        `---
name: codex-skill
description: A skill from Codex
---
# Codex Skill
Instructions here.`
      );

      // Load with codex-user source
      await registry.addLocation(userSkillsDir, 'codex-user', true);
      expect(registry.hasVendorSkills()).toBe(true);
    });

    it('returns true when claude-user skills exist', async () => {
      // Create a claude skill
      const claudeDir = path.join(userSkillsDir, 'claude-skill');
      await fs.ensureDir(claudeDir);
      await fs.writeFile(
        path.join(claudeDir, 'SKILL.md'),
        `---
name: claude-skill
description: A skill from Claude
---
# Claude Skill
Instructions here.`
      );

      // Load with claude-user source
      await registry.addLocation(userSkillsDir, 'claude-user', true);
      expect(registry.hasVendorSkills()).toBe(true);
    });

    it('returns true when claude-project skills exist', async () => {
      // Create a claude project skill
      const projectDir = path.join(workspaceDir, '.claude', 'skills', 'project-skill');
      await fs.ensureDir(projectDir);
      await fs.writeFile(
        path.join(projectDir, 'SKILL.md'),
        `---
name: project-skill
description: A project skill
---
# Project Skill`
      );

      await registry.addLocation(path.join(workspaceDir, '.claude', 'skills'), 'claude-project', true);
      expect(registry.hasVendorSkills()).toBe(true);
    });

    it('returns false for autohand-user skills only', async () => {
      // Create an autohand skill
      const autohandDir = path.join(userSkillsDir, 'autohand-skill');
      await fs.ensureDir(autohandDir);
      await fs.writeFile(
        path.join(autohandDir, 'SKILL.md'),
        `---
name: autohand-skill
description: An Autohand skill
---
# Autohand Skill`
      );

      await registry.addLocation(userSkillsDir, 'autohand-user', true);
      expect(registry.hasVendorSkills()).toBe(false);
    });
  });

  describe('getVendorSkills', () => {
    it('returns only vendor skills', async () => {
      // Create two separate directories for vendor and non-vendor skills
      const vendorRoot = path.join(tempRoot, 'vendor-root');
      const nonVendorRoot = path.join(tempRoot, 'nonvendor-root');
      await fs.ensureDir(vendorRoot);
      await fs.ensureDir(nonVendorRoot);

      // Vendor skill (claude)
      const claudeDir = path.join(vendorRoot, 'claude-skill');
      await fs.ensureDir(claudeDir);
      await fs.writeFile(
        path.join(claudeDir, 'SKILL.md'),
        `---
name: claude-skill
description: From Claude
---
# Claude`
      );

      // Non-vendor skill (autohand)
      const autohandDir = path.join(nonVendorRoot, 'autohand-skill');
      await fs.ensureDir(autohandDir);
      await fs.writeFile(
        path.join(autohandDir, 'SKILL.md'),
        `---
name: autohand-skill
description: From Autohand
---
# Autohand`
      );

      // Create registry and load vendor skills from vendor root
      const testRegistry = new SkillsRegistry(userSkillsDir, 'autohand-user');
      await testRegistry.addLocation(vendorRoot, 'claude-user', true);
      await testRegistry.addLocation(nonVendorRoot, 'autohand-user', true);

      // Should have 2 total skills
      expect(testRegistry.listSkills().length).toBe(2);

      // But only 1 vendor skill
      const vendorSkills = testRegistry.getVendorSkills();
      expect(vendorSkills.length).toBe(1);
      expect(vendorSkills[0].name).toBe('claude-skill');
    });
  });

  describe('importCommunitySkill', () => {
    it('imports a community skill package', async () => {
      const pkg: CommunitySkillPackage = {
        id: 'test-pkg-1',
        name: 'test-community-skill',
        description: 'A test community skill',
        body: `---
name: test-community-skill
description: A test community skill
allowedTools: read_file write_file
---
# Test Community Skill

This is a test skill from the community.`,
      };

      const result = await registry.importCommunitySkill(pkg, userSkillsDir);

      expect(result.success).toBe(true);
      expect(result.path).toContain('test-community-skill');

      // Verify skill was saved and registered
      const skill = registry.getSkill('test-community-skill');
      expect(skill).not.toBeNull();
      expect(skill?.description).toBe('A test community skill');
    });

    it('imports skill with allowed tools', async () => {
      const pkg: CommunitySkillPackage = {
        id: 'test-pkg-2',
        name: 'tools-skill',
        description: 'Skill with tools',
        body: `---
name: tools-skill
description: Skill with tools
allowed-tools: glob grep read_file write_file bash
---
# Tools Skill`,
        allowedTools: 'glob grep read_file write_file bash',
      };

      const result = await registry.importCommunitySkill(pkg, userSkillsDir);

      expect(result.success).toBe(true);
      const skill = registry.getSkill('tools-skill');
      // allowed-tools is stored as space-separated string in frontmatter
      expect(skill?.['allowed-tools']).toBe('glob grep read_file write_file bash');
    });

    it('returns false for invalid package', async () => {
      const pkg: CommunitySkillPackage = {
        id: 'invalid',
        name: '',
        description: '',
        body: '', // Empty body
      };

      const result = await registry.importCommunitySkill(pkg, userSkillsDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('skips if skill already exists', async () => {
      // Create existing skill
      const existingDir = path.join(userSkillsDir, 'existing-skill');
      await fs.ensureDir(existingDir);
      await fs.writeFile(
        path.join(existingDir, 'SKILL.md'),
        `---
name: existing-skill
description: Already exists
---
# Existing`
      );

      const pkg: CommunitySkillPackage = {
        id: 'dup',
        name: 'existing-skill',
        description: 'Duplicate',
        body: `---
name: existing-skill
description: Duplicate
---
# Duplicate`,
      };

      const result = await registry.importCommunitySkill(pkg, userSkillsDir);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
    });
  });

  describe('addLocationWithAutoCopyAndBackup', () => {
    it('copies skills and queues backup', async () => {
      registry.setCommunityClient(communityClient);

      // Create source skills
      const sourceDir = path.join(tempRoot, 'source-skills');
      const skillDir = path.join(sourceDir, 'backup-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: backup-skill
description: Skill to be backed up
---
# Backup Skill
Instructions here.`
      );

      const targetDir = path.join(tempRoot, 'target-skills');

      // Mock backup to fail (simulating offline)
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await registry.addLocationWithAutoCopyAndBackup(
        sourceDir,
        'codex-user',
        targetDir,
        true
      );

      expect(result.copiedCount).toBe(1);
      expect(result.copiedSkills).toContain('backup-skill');

      // Verify backup was queued
      const queueStatus = communityClient.getQueueStatus();
      expect(queueStatus.pending).toBeGreaterThan(0);
    });

    it('skips backup when community client is not set', async () => {
      // Don't set community client

      const sourceDir = path.join(tempRoot, 'source-no-backup');
      const skillDir = path.join(sourceDir, 'no-backup-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: no-backup-skill
description: No backup
---
# No Backup`
      );

      const targetDir = path.join(tempRoot, 'target-no-backup');

      const result = await registry.addLocationWithAutoCopyAndBackup(
        sourceDir,
        'codex-user',
        targetDir,
        true
      );

      expect(result.copiedCount).toBe(1);
      // Should not throw, just skip backup
    });

    it('includes original source in backup payload', async () => {
      registry.setCommunityClient(communityClient);

      const sourceDir = path.join(tempRoot, 'claude-source');
      const skillDir = path.join(sourceDir, 'claude-sourced-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: claude-sourced-skill
description: From Claude
---
# Claude Sourced`
      );

      const targetDir = path.join(tempRoot, 'target-claude');

      // Mock successful backup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, backed: 1, skipped: 0 }),
      });

      await registry.addLocationWithAutoCopyAndBackup(
        sourceDir,
        'claude-user',
        targetDir,
        true
      );

      // Verify the request body included the source
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/skills-backup'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('claude-user'),
        })
      );
    });
  });

  describe('backupAllVendorSkills', () => {
    it('backs up all vendor skills to API', async () => {
      registry.setCommunityClient(communityClient);

      // Create vendor skills - each in their own subdirectory with SKILL.md
      const codexSkillDir = path.join(userSkillsDir, 'codex-backup');
      await fs.ensureDir(codexSkillDir);
      await fs.writeFile(
        path.join(codexSkillDir, 'SKILL.md'),
        `---
name: codex-backup
description: Codex skill for backup
---
# Codex Backup`
      );

      const claudeSkillDir = path.join(userSkillsDir, 'claude-backup');
      await fs.ensureDir(claudeSkillDir);
      await fs.writeFile(
        path.join(claudeSkillDir, 'SKILL.md'),
        `---
name: claude-backup
description: Claude skill for backup
---
# Claude Backup`
      );

      // Load from the parent directory - addLocation scans subdirectories
      await registry.addLocation(userSkillsDir, 'codex-user', true);

      // Reload claude skill with claude-user source (will override codex-user)
      await registry.addLocation(claudeSkillDir, 'claude-user', true);

      // Verify we have 2 vendor skills loaded
      const vendorSkills = registry.getVendorSkills();
      expect(vendorSkills.length).toBe(2);

      // Mock successful backup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, backed: 2, skipped: 0 }),
      });

      const result = await registry.backupAllVendorSkills();

      expect(result.backed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('returns zero when community client is not set', async () => {
      // Add a vendor skill without community client
      const skillDir = path.join(userSkillsDir, 'no-client-skill');
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: no-client-skill
description: No client
---
# No Client`
      );

      await registry.addLocation(skillDir, 'codex-user', true);

      const result = await registry.backupAllVendorSkills();

      expect(result.backed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('returns zero when no vendor skills exist', async () => {
      registry.setCommunityClient(communityClient);
      await registry.initialize();

      const result = await registry.backupAllVendorSkills();

      expect(result.backed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
