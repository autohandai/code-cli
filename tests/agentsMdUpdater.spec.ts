/**
 * AgentsMdUpdater Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { AgentsMdUpdater } from '../src/core/AgentsMdUpdater.js';
import type { ProjectPatterns } from '../src/core/PatternDetector.js';

describe('AgentsMdUpdater', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `agents-md-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('update', () => {
    it('should create AGENTS.md if it does not exist', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      const patterns: ProjectPatterns = {
        techStack: ['TypeScript', 'React'],
        packageManager: 'bun',
      };

      await updater.update({ patterns });

      const agentsPath = path.join(tempDir, 'AGENTS.md');
      expect(await fs.pathExists(agentsPath)).toBe(true);
    });

    it('should add Tech Stack section', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      const patterns: ProjectPatterns = {
        techStack: ['TypeScript', 'React', 'Node.js'],
      };

      await updater.update({ patterns });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('## Tech Stack');
      expect(content).toContain('- TypeScript');
      expect(content).toContain('- React');
      expect(content).toContain('- Node.js');
    });

    it('should add Commands section', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      const patterns: ProjectPatterns = {
        techStack: [],
        testCommand: 'bun test',
        buildCommand: 'bun run build',
        lintCommand: 'bun run lint',
        packageManager: 'bun',
        framework: 'Next.js 14',
      };

      await updater.update({ patterns });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('## Commands');
      expect(content).toContain('**Test:** `bun test`');
      expect(content).toContain('**Build:** `bun run build`');
      expect(content).toContain('**Lint:** `bun run lint`');
      expect(content).toContain('**Package Manager:** `bun`');
      expect(content).toContain('**Framework:** Next.js 14');
    });

    it('should add Skills Used section', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      const usedSkills = ['code-review', 'test-writer', 'code-review', 'debugger'];

      await updater.update({ usedSkills });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('## Skills Used');
      expect(content).toContain('- code-review (2x)');
      expect(content).toContain('- test-writer (1x)');
      expect(content).toContain('- debugger (1x)');
    });

    it('should add Conventions section', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      const conventions = [
        'Use functional components with hooks',
        'Prefer TypeScript strict mode',
        'Tests required for all new features',
      ];

      await updater.update({ conventions });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('## Conventions');
      expect(content).toContain('- Use functional components with hooks');
      expect(content).toContain('- Prefer TypeScript strict mode');
      expect(content).toContain('- Tests required for all new features');
    });

    it('should update existing section', async () => {
      // Create initial AGENTS.md
      await fs.writeFile(
        path.join(tempDir, 'AGENTS.md'),
        '# Project Autopilot\n\n## Tech Stack\n\n- JavaScript\n\n## Other\n\nSome content\n'
      );

      const updater = new AgentsMdUpdater(tempDir);
      const patterns: ProjectPatterns = {
        techStack: ['TypeScript', 'React'],
      };

      await updater.update({ patterns });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('- TypeScript');
      expect(content).toContain('- React');
      expect(content).not.toContain('- JavaScript'); // Old value replaced
      expect(content).toContain('## Other'); // Other section preserved
    });

    it('should preserve existing content when adding new sections', async () => {
      // Create initial AGENTS.md with custom content
      await fs.writeFile(
        path.join(tempDir, 'AGENTS.md'),
        '# My Project\n\nThis is my project description.\n\n## Custom Section\n\nCustom content here.\n'
      );

      const updater = new AgentsMdUpdater(tempDir);
      const patterns: ProjectPatterns = {
        techStack: ['TypeScript'],
        testCommand: 'npm test',
      };

      await updater.update({ patterns });

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('This is my project description.');
      expect(content).toContain('## Custom Section');
      expect(content).toContain('Custom content here.');
      expect(content).toContain('## Tech Stack');
      expect(content).toContain('## Commands');
    });
  });

  describe('exists', () => {
    it('should return false if AGENTS.md does not exist', async () => {
      const updater = new AgentsMdUpdater(tempDir);
      expect(await updater.exists()).toBe(false);
    });

    it('should return true if AGENTS.md exists', async () => {
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Test');
      const updater = new AgentsMdUpdater(tempDir);
      expect(await updater.exists()).toBe(true);
    });
  });

  describe('formatPatternsSummary', () => {
    it('should format patterns summary correctly', () => {
      const patterns: ProjectPatterns = {
        techStack: ['TypeScript', 'React'],
        framework: 'Next.js 14',
        packageManager: 'bun',
      };

      const summary = AgentsMdUpdater.formatPatternsSummary(patterns);

      expect(summary).toContain('Tech: TypeScript, React');
      expect(summary).toContain('Framework: Next.js 14');
      expect(summary).toContain('PM: bun');
    });

    it('should handle empty patterns', () => {
      const patterns: ProjectPatterns = {
        techStack: [],
      };

      const summary = AgentsMdUpdater.formatPatternsSummary(patterns);

      expect(summary).toBe('No patterns detected');
    });
  });
});
