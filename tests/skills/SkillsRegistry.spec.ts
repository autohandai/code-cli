/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';

describe('SkillsRegistry', () => {
  const tempRoot = path.join(os.tmpdir(), `skills-registry-test-${Date.now()}`);
  const userSkillsDir = path.join(tempRoot, 'user-skills');
  const projectSkillsDir = path.join(tempRoot, 'project-skills');
  const workspaceRoot = path.join(tempRoot, 'workspace');

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
    await fs.ensureDir(userSkillsDir);
    await fs.ensureDir(projectSkillsDir);
    await fs.ensureDir(workspaceRoot);
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  async function createSkill(baseDir: string, name: string, description: string, body = ''): Promise<string> {
    const skillDir = path.join(baseDir, name);
    await fs.ensureDir(skillDir);
    const skillPath = path.join(skillDir, 'SKILL.md');
    const content = `---
name: ${name}
description: ${description}
---

${body}
`;
    await fs.writeFile(skillPath, content, 'utf-8');
    return skillPath;
  }

  describe('initialization', () => {
    it('initializes with empty skill list when no skills exist', async () => {
      const emptyDir = path.join(tempRoot, 'empty-skills');
      await fs.ensureDir(emptyDir);

      const registry = new SkillsRegistry(emptyDir);
      await registry.initialize();

      const skills = registry.listSkills();
      expect(skills).toEqual([]);
    });

    it('loads skills from user directory', async () => {
      const testDir = path.join(tempRoot, 'test-user-skills-1');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'user-skill-1', 'First user skill');
      await createSkill(testDir, 'user-skill-2', 'Second user skill');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const skills = registry.listSkills();
      expect(skills.length).toBe(2);
      expect(skills.map(s => s.name)).toContain('user-skill-1');
      expect(skills.map(s => s.name)).toContain('user-skill-2');
    });

    it('loads skills recursively when configured', async () => {
      const testDir = path.join(tempRoot, 'test-recursive-skills');
      await fs.ensureDir(testDir);

      // Create nested skill directories
      await createSkill(testDir, 'top-level-skill', 'Top level');
      const nestedDir = path.join(testDir, 'category');
      await createSkill(nestedDir, 'nested-skill', 'Nested skill');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const skills = registry.listSkills();
      expect(skills.length).toBe(2);
      expect(skills.map(s => s.name)).toContain('top-level-skill');
      expect(skills.map(s => s.name)).toContain('nested-skill');
    });
  });

  describe('skill activation', () => {
    it('activates a skill by name', async () => {
      const testDir = path.join(tempRoot, 'test-activate-skills');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'activatable-skill', 'A skill to activate', 'Skill body content');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const activated = registry.activateSkill('activatable-skill');
      expect(activated).toBe(true);

      const activeSkills = registry.getActiveSkills();
      expect(activeSkills.length).toBe(1);
      expect(activeSkills[0].name).toBe('activatable-skill');
      expect(activeSkills[0].isActive).toBe(true);
    });

    it('returns false when trying to activate non-existent skill', async () => {
      const testDir = path.join(tempRoot, 'test-activate-nonexistent');
      await fs.ensureDir(testDir);

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const activated = registry.activateSkill('nonexistent-skill');
      expect(activated).toBe(false);
    });

    it('deactivates a skill by name', async () => {
      const testDir = path.join(tempRoot, 'test-deactivate-skills');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'deactivatable-skill', 'A skill to deactivate');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      registry.activateSkill('deactivatable-skill');
      expect(registry.getActiveSkills().length).toBe(1);

      const deactivated = registry.deactivateSkill('deactivatable-skill');
      expect(deactivated).toBe(true);
      expect(registry.getActiveSkills().length).toBe(0);
    });

    it('can activate multiple skills', async () => {
      const testDir = path.join(tempRoot, 'test-multi-activate');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'skill-a', 'Skill A');
      await createSkill(testDir, 'skill-b', 'Skill B');
      await createSkill(testDir, 'skill-c', 'Skill C');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      registry.activateSkill('skill-a');
      registry.activateSkill('skill-c');

      const activeSkills = registry.getActiveSkills();
      expect(activeSkills.length).toBe(2);
      expect(activeSkills.map(s => s.name)).toContain('skill-a');
      expect(activeSkills.map(s => s.name)).toContain('skill-c');
      expect(activeSkills.map(s => s.name)).not.toContain('skill-b');
    });
  });

  describe('skill lookup', () => {
    it('finds a skill by name', async () => {
      const testDir = path.join(tempRoot, 'test-lookup-skills');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'findable-skill', 'A findable skill', 'Body content');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const skill = registry.getSkill('findable-skill');
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('findable-skill');
      expect(skill!.description).toBe('A findable skill');
    });

    it('returns null for non-existent skill', async () => {
      const testDir = path.join(tempRoot, 'test-lookup-nonexistent');
      await fs.ensureDir(testDir);

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const skill = registry.getSkill('nonexistent');
      expect(skill).toBeNull();
    });
  });

  describe('skill collision handling', () => {
    it('later sources override earlier sources with same name', async () => {
      const earlyDir = path.join(tempRoot, 'test-collision-early');
      const lateDir = path.join(tempRoot, 'test-collision-late');
      await fs.ensureDir(earlyDir);
      await fs.ensureDir(lateDir);

      await createSkill(earlyDir, 'collision-skill', 'Early version');
      await createSkill(lateDir, 'collision-skill', 'Late version (should win)');

      const registry = new SkillsRegistry(earlyDir);
      await registry.initialize();
      await registry.addLocation(lateDir, 'autohand-project');

      const skill = registry.getSkill('collision-skill');
      expect(skill).not.toBeNull();
      expect(skill!.description).toBe('Late version (should win)');
    });
  });

  describe('similarity search', () => {
    it('finds similar skills by description', async () => {
      const testDir = path.join(tempRoot, 'test-similarity-skills');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'typescript-linter', 'A skill for linting TypeScript code');
      await createSkill(testDir, 'python-formatter', 'A skill for formatting Python code');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const matches = registry.findSimilar('linting TypeScript');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.name).toBe('typescript-linter');
    });

    it('returns empty array when no similar skills found', async () => {
      const testDir = path.join(tempRoot, 'test-no-similar');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'unrelated-skill', 'Something completely different');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      const matches = registry.findSimilar('xyz123abc');
      expect(matches.length).toBe(0);
    });
  });

  describe('workspace support', () => {
    it('sets workspace and loads project skills', async () => {
      const userDir = path.join(tempRoot, 'test-workspace-user');
      const wsRoot = path.join(tempRoot, 'test-workspace-project');
      const projectSkillsPath = path.join(wsRoot, '.autohand', 'skills');

      await fs.ensureDir(userDir);
      await fs.ensureDir(projectSkillsPath);

      await createSkill(userDir, 'user-global-skill', 'Global user skill');
      await createSkill(projectSkillsPath, 'project-local-skill', 'Project local skill');

      const registry = new SkillsRegistry(userDir);
      await registry.initialize();
      await registry.setWorkspace(wsRoot);

      const skills = registry.listSkills();
      expect(skills.map(s => s.name)).toContain('user-global-skill');
      expect(skills.map(s => s.name)).toContain('project-local-skill');
    });
  });

  describe('deactivateAll', () => {
    it('deactivates all active skills', async () => {
      const testDir = path.join(tempRoot, 'test-deactivate-all');
      await fs.ensureDir(testDir);

      await createSkill(testDir, 'skill-1', 'First');
      await createSkill(testDir, 'skill-2', 'Second');

      const registry = new SkillsRegistry(testDir);
      await registry.initialize();

      registry.activateSkill('skill-1');
      registry.activateSkill('skill-2');
      expect(registry.getActiveSkills().length).toBe(2);

      registry.deactivateAll();
      expect(registry.getActiveSkills().length).toBe(0);
    });
  });

  describe('auto-copy on discovery', () => {
    it('copies codex-user skills to autohand-user location', async () => {
      const codexDir = path.join(tempRoot, 'test-autocopy-codex');
      const autohandDir = path.join(tempRoot, 'test-autocopy-autohand-1');
      await fs.ensureDir(codexDir);
      await fs.ensureDir(autohandDir);

      // Create a skill in codex location
      await createSkill(codexDir, 'codex-skill', 'A codex skill');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      // Add codex location with auto-copy enabled
      await registry.addLocationWithAutoCopy(codexDir, 'codex-user', autohandDir);

      // Verify skill was copied to autohand location
      const copiedPath = path.join(autohandDir, 'codex-skill', 'SKILL.md');
      expect(await fs.pathExists(copiedPath)).toBe(true);

      // Verify the skill is registered
      const skill = registry.getSkill('codex-skill');
      expect(skill).not.toBeNull();
    });

    it('copies claude-user skills to autohand-user location', async () => {
      const claudeDir = path.join(tempRoot, 'test-autocopy-claude');
      const autohandDir = path.join(tempRoot, 'test-autocopy-autohand-2');
      await fs.ensureDir(claudeDir);
      await fs.ensureDir(autohandDir);

      // Create a skill in claude location
      await createSkill(claudeDir, 'claude-skill', 'A claude skill');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      // Add claude location with auto-copy enabled
      await registry.addLocationWithAutoCopy(claudeDir, 'claude-user', autohandDir);

      // Verify skill was copied to autohand location
      const copiedPath = path.join(autohandDir, 'claude-skill', 'SKILL.md');
      expect(await fs.pathExists(copiedPath)).toBe(true);
    });

    it('does not overwrite existing skills in autohand location', async () => {
      const sourceDir = path.join(tempRoot, 'test-autocopy-source');
      const autohandDir = path.join(tempRoot, 'test-autocopy-no-overwrite');
      await fs.ensureDir(sourceDir);
      await fs.ensureDir(autohandDir);

      // Create skill in both locations with different descriptions
      await createSkill(autohandDir, 'existing-skill', 'Original autohand skill');
      await createSkill(sourceDir, 'existing-skill', 'Trying to overwrite');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      // Try to add source location - should not overwrite
      await registry.addLocationWithAutoCopy(sourceDir, 'codex-user', autohandDir);

      // Read the skill file content - should still have original description
      const skillPath = path.join(autohandDir, 'existing-skill', 'SKILL.md');
      const content = await fs.readFile(skillPath, 'utf-8');
      expect(content).toContain('Original autohand skill');
      expect(content).not.toContain('Trying to overwrite');
    });

    it('copies claude-project skills to autohand-project location', async () => {
      const wsRoot = path.join(tempRoot, 'test-autocopy-workspace');
      const claudeProjectDir = path.join(wsRoot, '.claude', 'skills');
      const autohandProjectDir = path.join(wsRoot, '.autohand', 'skills');
      const autohandUserDir = path.join(tempRoot, 'test-autocopy-user-skills');

      await fs.ensureDir(claudeProjectDir);
      await fs.ensureDir(autohandUserDir);

      // Create a skill in claude project location
      await createSkill(claudeProjectDir, 'project-skill', 'A project-level skill');

      const registry = new SkillsRegistry(autohandUserDir);
      await registry.initialize();

      // Set workspace - should trigger auto-copy
      await registry.setWorkspaceWithAutoCopy(wsRoot);

      // Verify skill was copied to autohand project location
      const copiedPath = path.join(autohandProjectDir, 'project-skill', 'SKILL.md');
      expect(await fs.pathExists(copiedPath)).toBe(true);
    });

    it('preserves directory structure when copying nested skills', async () => {
      const sourceDir = path.join(tempRoot, 'test-autocopy-nested-source');
      const autohandDir = path.join(tempRoot, 'test-autocopy-nested-dest');
      const categoryDir = path.join(sourceDir, 'category');

      await fs.ensureDir(sourceDir);
      await fs.ensureDir(autohandDir);
      await fs.ensureDir(categoryDir);

      // Create nested skills
      await createSkill(sourceDir, 'top-skill', 'Top level skill');
      await createSkill(categoryDir, 'nested-skill', 'Nested skill');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      // Add source with auto-copy
      await registry.addLocationWithAutoCopy(sourceDir, 'codex-user', autohandDir, true);

      // Verify both skills were copied preserving structure
      expect(await fs.pathExists(path.join(autohandDir, 'top-skill', 'SKILL.md'))).toBe(true);
      expect(await fs.pathExists(path.join(autohandDir, 'category', 'nested-skill', 'SKILL.md'))).toBe(true);
    });

    it('handles copy errors gracefully', async () => {
      const sourceDir = path.join(tempRoot, 'test-autocopy-error-source');
      const autohandDir = path.join(tempRoot, 'test-autocopy-error-dest');

      await fs.ensureDir(sourceDir);
      await fs.ensureDir(autohandDir);

      // Create a valid skill
      await createSkill(sourceDir, 'valid-skill', 'A valid skill');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      // Make destination read-only for one skill to simulate error
      const readOnlyDir = path.join(autohandDir, 'valid-skill');
      await fs.ensureDir(readOnlyDir);
      await fs.writeFile(path.join(readOnlyDir, 'SKILL.md'), 'invalid content');

      // Add source - should not throw even when skill already exists (skipped)
      const result = await registry.addLocationWithAutoCopy(sourceDir, 'codex-user', autohandDir);
      expect(result.skippedCount).toBe(1);
      expect(result.errorCount).toBe(0);

      // Skill should still be loaded from source
      const skill = registry.getSkill('valid-skill');
      expect(skill).not.toBeNull();
    });

    it('tracks copied skills count', async () => {
      const sourceDir = path.join(tempRoot, 'test-autocopy-count-source');
      const autohandDir = path.join(tempRoot, 'test-autocopy-count-dest');

      await fs.ensureDir(sourceDir);
      await fs.ensureDir(autohandDir);

      await createSkill(sourceDir, 'skill-a', 'Skill A');
      await createSkill(sourceDir, 'skill-b', 'Skill B');

      const registry = new SkillsRegistry(autohandDir);
      await registry.initialize();

      const copyResult = await registry.addLocationWithAutoCopy(sourceDir, 'codex-user', autohandDir);

      expect(copyResult.copiedCount).toBe(2);
      expect(copyResult.skippedCount).toBe(0);
    });
  });
});
