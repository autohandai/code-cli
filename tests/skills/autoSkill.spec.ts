/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock chalk for tests that call runAutoSkillGeneration
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    gray: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  }
}));

import { ProjectAnalyzer, generateAutoSkills, runAutoSkillGeneration, AVAILABLE_TOOLS, getAllTools } from '../../src/skills/autoSkill.js';

describe('AVAILABLE_TOOLS', () => {
  it('exports categorized tool lists', () => {
    expect(AVAILABLE_TOOLS.file).toContain('read_file');
    expect(AVAILABLE_TOOLS.file).toContain('write_file');
    expect(AVAILABLE_TOOLS.git).toContain('git_status');
    expect(AVAILABLE_TOOLS.git).toContain('git_commit');
    expect(AVAILABLE_TOOLS.command).toContain('run_command');
    expect(AVAILABLE_TOOLS.dependencies).toContain('add_dependency');
    expect(AVAILABLE_TOOLS.memory).toContain('save_memory');
    expect(AVAILABLE_TOOLS.planning).toContain('plan');
  });

  it('getAllTools returns flattened array of all tools', () => {
    const allTools = getAllTools();
    expect(allTools).toContain('read_file');
    expect(allTools).toContain('git_status');
    expect(allTools).toContain('run_command');
    expect(allTools.length).toBeGreaterThan(20);
  });
});

describe('ProjectAnalyzer', () => {
  const tempRoot = path.join(os.tmpdir(), `autoskill-test-${Date.now()}`);

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  describe('language detection', () => {
    it('detects TypeScript from package.json', async () => {
      const projectDir = path.join(tempRoot, 'ts-project');
      await fs.ensureDir(projectDir);
      await fs.ensureDir(path.join(projectDir, 'src'));
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-ts',
        devDependencies: {
          typescript: '^5.0.0'
        }
      });
      await fs.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1;');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('typescript');
    });

    it('detects JavaScript from package.json', async () => {
      const projectDir = path.join(tempRoot, 'js-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-js'
      });
      await fs.ensureDir(path.join(projectDir, 'src'));
      await fs.writeFile(path.join(projectDir, 'src', 'index.js'), 'module.exports = {}');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('javascript');
    });

    it('detects Python from requirements.txt', async () => {
      const projectDir = path.join(tempRoot, 'py-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'requirements.txt'), 'flask==2.0.0\nrequests>=2.28.0');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('python');
    });

    it('detects Python from pyproject.toml', async () => {
      const projectDir = path.join(tempRoot, 'py-toml-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'pyproject.toml'), '[tool.poetry]\nname = "test"');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('python');
    });

    it('detects Rust from Cargo.toml', async () => {
      const projectDir = path.join(tempRoot, 'rust-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\nversion = "0.1.0"');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('rust');
    });

    it('detects Go from go.mod', async () => {
      const projectDir = path.join(tempRoot, 'go-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'go.mod'), 'module github.com/test/test\n\ngo 1.21');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('go');
    });
  });

  describe('framework detection', () => {
    it('detects React from dependencies', async () => {
      const projectDir = path.join(tempRoot, 'react-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-react',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('react');
    });

    it('detects Next.js from dependencies', async () => {
      const projectDir = path.join(tempRoot, 'nextjs-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-next',
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('nextjs');
    });

    it('detects Vue from dependencies', async () => {
      const projectDir = path.join(tempRoot, 'vue-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-vue',
        dependencies: {
          vue: '^3.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('vue');
    });

    it('detects Express from dependencies', async () => {
      const projectDir = path.join(tempRoot, 'express-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-express',
        dependencies: {
          express: '^4.18.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('express');
    });

    it('detects Flask from requirements.txt', async () => {
      const projectDir = path.join(tempRoot, 'flask-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'requirements.txt'), 'flask==2.0.0');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('flask');
    });

    it('detects Django from requirements.txt', async () => {
      const projectDir = path.join(tempRoot, 'django-project');
      await fs.ensureDir(projectDir);
      await fs.writeFile(path.join(projectDir, 'requirements.txt'), 'django>=4.0');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.frameworks).toContain('django');
    });
  });

  describe('pattern detection', () => {
    it('detects CLI tool patterns from bin field', async () => {
      const projectDir = path.join(tempRoot, 'cli-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-cli',
        bin: {
          'my-cli': './dist/index.js'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.patterns).toContain('cli');
    });

    it('detects CLI tool from commander dependency', async () => {
      const projectDir = path.join(tempRoot, 'cli-commander-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-cli',
        dependencies: {
          commander: '^12.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.patterns).toContain('cli');
    });

    it('detects testing patterns from vitest', async () => {
      const projectDir = path.join(tempRoot, 'vitest-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-vitest',
        devDependencies: {
          vitest: '^1.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.patterns).toContain('testing');
    });

    it('detects monorepo pattern from workspaces', async () => {
      const projectDir = path.join(tempRoot, 'monorepo-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test-monorepo',
        workspaces: ['packages/*']
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.patterns).toContain('monorepo');
    });
  });

  describe('platform and environment detection', () => {
    it('detects platform correctly', async () => {
      const projectDir = path.join(tempRoot, 'platform-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test' });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(['darwin', 'linux', 'win32', 'unknown']).toContain(analysis.platform);
    });

    it('detects git repository', async () => {
      const projectDir = path.join(tempRoot, 'git-project');
      await fs.ensureDir(projectDir);
      await fs.ensureDir(path.join(projectDir, '.git'));
      await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test' });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.hasGit).toBe(true);
    });

    it('detects CI/CD from GitHub workflows', async () => {
      const projectDir = path.join(tempRoot, 'ci-project');
      await fs.ensureDir(projectDir);
      await fs.ensureDir(path.join(projectDir, '.github', 'workflows'));
      await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test' });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.hasCI).toBe(true);
    });

    it('detects package manager from lockfiles', async () => {
      const projectDir = path.join(tempRoot, 'pnpm-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test' });
      await fs.writeFile(path.join(projectDir, 'pnpm-lock.yaml'), '');

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.packageManager).toBe('pnpm');
    });

    it('detects tests from vitest dependency', async () => {
      const projectDir = path.join(tempRoot, 'tests-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'test',
        devDependencies: { vitest: '^1.0.0' }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.hasTests).toBe(true);
    });
  });

  describe('full analysis', () => {
    it('returns comprehensive analysis for a complex project', async () => {
      const projectDir = path.join(tempRoot, 'complex-project');
      await fs.ensureDir(projectDir);
      await fs.writeJson(path.join(projectDir, 'package.json'), {
        name: 'complex-project',
        bin: './dist/cli.js',
        dependencies: {
          react: '^18.0.0',
          next: '^14.0.0',
          express: '^4.18.0'
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^1.0.0'
        }
      });

      const analyzer = new ProjectAnalyzer(projectDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages.length).toBeGreaterThan(0);
      expect(analysis.frameworks.length).toBeGreaterThan(0);
      expect(analysis.patterns.length).toBeGreaterThan(0);
      expect(analysis.projectName).toBe('complex-project');
      expect(analysis.platform).toBeDefined();
      expect(analysis.hasTests).toBe(true);
    });
  });
});

describe('generateAutoSkills', () => {
  const baseAnalysis = {
    projectName: 'test',
    languages: ['typescript'],
    frameworks: ['react'],
    patterns: ['testing'],
    dependencies: [],
    filePatterns: [],
    platform: 'darwin' as const,
    hasGit: true,
    hasTests: true,
    hasCI: false,
    packageManager: 'npm' as const,
  };

  it('returns empty array when LLM fails', async () => {
    const mockLLM = {
      complete: vi.fn().mockRejectedValue(new Error('LLM error'))
    };

    const result = await generateAutoSkills(baseAnalysis, mockLLM as any);

    expect(result).toEqual([]);
  });

  it('parses LLM response into skills array', async () => {
    const mockResponse = {
      content: JSON.stringify([
        {
          name: 'typescript-helper',
          description: 'Helps with TypeScript development',
          body: '# TypeScript Helper\n\nAssist with TypeScript code.',
          allowedTools: ['read_file', 'write_file']
        },
        {
          name: 'react-components',
          description: 'Creates React components',
          body: '# React Components\n\nHelp create React components.',
          allowedTools: ['read_file', 'write_file', 'run_command']
        }
      ])
    };

    const mockLLM = {
      complete: vi.fn().mockResolvedValue(mockResponse)
    };

    const result = await generateAutoSkills(
      { ...baseAnalysis, patterns: [] },
      mockLLM as any
    );

    expect(result.length).toBe(2);
    expect(result[0].name).toBe('typescript-helper');
    expect(result[0].allowedTools).toContain('read_file');
    expect(result[1].name).toBe('react-components');
  });

  it('handles malformed LLM response gracefully', async () => {
    const mockLLM = {
      complete: vi.fn().mockResolvedValue({ content: 'not valid json' })
    };

    const result = await generateAutoSkills(
      { ...baseAnalysis, frameworks: [], patterns: [] },
      mockLLM as any
    );

    expect(result).toEqual([]);
  });
});

describe('runAutoSkillGeneration', () => {
  const tempRoot = path.join(os.tmpdir(), `autoskill-run-test-${Date.now()}`);

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  it('saves generated skills to project .autohand/skills folder', async () => {
    const projectDir = path.join(tempRoot, 'save-skills-project');
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, 'package.json'), {
      name: 'test-project',
      devDependencies: { typescript: '^5.0.0' }
    });

    const mockResponse = {
      content: JSON.stringify([
        {
          name: 'generated-skill',
          description: 'A generated skill',
          body: '# Generated Skill\n\nThis skill was auto-generated.',
          allowedTools: ['read_file', 'write_file', 'git_status']
        }
      ])
    };

    const mockLLM = {
      complete: vi.fn().mockResolvedValue(mockResponse)
    };

    const result = await runAutoSkillGeneration(projectDir, mockLLM as any);

    expect(result.success).toBe(true);
    expect(result.skillsGenerated).toBe(1);

    // Verify skill was saved
    const skillPath = path.join(projectDir, '.autohand', 'skills', 'generated-skill', 'SKILL.md');
    expect(await fs.pathExists(skillPath)).toBe(true);

    const content = await fs.readFile(skillPath, 'utf-8');
    expect(content).toContain('name: generated-skill');
    expect(content).toContain('A generated skill');
    expect(content).toContain('allowed-tools: read_file write_file git_status');
  });

  it('returns failure when no skills generated', async () => {
    const projectDir = path.join(tempRoot, 'no-skills-project');
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'empty' });

    const mockLLM = {
      complete: vi.fn().mockResolvedValue({ content: '[]' })
    };

    const result = await runAutoSkillGeneration(projectDir, mockLLM as any);

    expect(result.success).toBe(false);
    expect(result.skillsGenerated).toBe(0);
  });

  it('handles analysis failure gracefully', async () => {
    const projectDir = path.join(tempRoot, 'nonexistent-project-for-test');
    // Don't create the directory - analysis should fail

    const mockLLM = {
      complete: vi.fn().mockResolvedValue({ content: '[]' })
    };

    const result = await runAutoSkillGeneration(projectDir, mockLLM as any);

    expect(result.success).toBe(false);
  });
});
