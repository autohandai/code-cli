/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fsExtra from 'fs-extra';
import { ProjectAnalyzer } from '../../src/onboarding/projectAnalyzer';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readJson: vi.fn(),
  readFile: vi.fn()
}));

const mockPathExists = fsExtra.pathExists as ReturnType<typeof vi.fn>;
const mockReadJson = fsExtra.readJson as ReturnType<typeof vi.fn>;
const mockReadFile = fsExtra.readFile as ReturnType<typeof vi.fn>;

describe('ProjectAnalyzer', () => {
  const testWorkspace = '/test/workspace';
  let analyzer: ProjectAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    analyzer = new ProjectAnalyzer(testWorkspace);

    // Default: nothing exists
    mockPathExists.mockResolvedValue(false);
  });

  describe('Language Detection', () => {
    it('should detect TypeScript when typescript is in devDependencies', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          typescript: '^5.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.language).toBe('TypeScript');
    });

    it('should detect JavaScript when no typescript dependency', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          express: '^4.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.language).toBe('JavaScript');
    });

    it('should detect Rust when Cargo.toml exists', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/Cargo.toml`
      );
      mockReadFile.mockResolvedValue(`
[package]
name = "test-project"
version = "0.1.0"
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Rust');
    });

    it('should detect Go when go.mod exists', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/go.mod`
      );
      mockReadFile.mockResolvedValue(`
module example.com/test
go 1.21
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Go');
    });

    it('should detect Python when pyproject.toml exists', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/pyproject.toml`
      );
      mockReadFile.mockResolvedValue(`
[project]
name = "test-project"
version = "0.1.0"
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Python');
    });

    it('should detect Python when requirements.txt exists', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/requirements.txt`
      );
      mockReadFile.mockResolvedValue(`
flask==2.0.0
requests==2.28.0
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Python');
    });

    it('should return undefined when no language markers found', async () => {
      // Default: nothing exists
      const info = await analyzer.analyze();

      expect(info.language).toBeUndefined();
    });
  });

  describe('Framework Detection', () => {
    it('should detect Next.js', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Next.js');
    });

    it('should detect React (without Next.js)', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('React');
    });

    it('should detect Vue', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          vue: '^3.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Vue');
    });

    it('should detect Express', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          express: '^4.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Express');
    });

    it('should detect Fastify', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          fastify: '^4.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Fastify');
    });

    it('should detect Svelte', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          svelte: '^4.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Svelte');
    });

    it('should detect Angular', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          '@angular/core': '^17.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Angular');
    });

    it('should detect NestJS', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          '@nestjs/core': '^10.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('NestJS');
    });

    it('should prioritize Next.js over React', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.framework).toBe('Next.js');
    });
  });

  describe('Package Manager Detection', () => {
    it('should detect bun from bun.lock', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/bun.lock`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('bun');
    });

    it('should detect bun from bun.lockb', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/bun.lockb`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('bun');
    });

    it('should detect pnpm from pnpm-lock.yaml', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/pnpm-lock.yaml`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('pnpm');
    });

    it('should detect yarn from yarn.lock', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/yarn.lock`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('yarn');
    });

    it('should detect npm from package-lock.json', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/package-lock.json`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('npm');
    });

    it('should default to npm when only package.json exists', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({ name: 'test' });

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('npm');
    });

    it('should detect cargo for Rust projects', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/Cargo.toml`
      );
      mockReadFile.mockResolvedValue('[package]\nname = "test"');

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('cargo');
    });

    it('should detect go for Go projects', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/go.mod`
      );
      mockReadFile.mockResolvedValue('module example.com/test\ngo 1.21');

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('go');
    });

    it('should detect poetry for Python with poetry.lock', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/pyproject.toml`) return true;
        if (path === `${testWorkspace}/poetry.lock`) return true;
        return false;
      });
      mockReadFile.mockResolvedValue('[project]\nname = "test"');

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('poetry');
    });

    it('should detect pip for Python with requirements.txt', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/requirements.txt`
      );
      mockReadFile.mockResolvedValue('flask==2.0.0');

      const info = await analyzer.analyze();

      expect(info.packageManager).toBe('pip');
    });
  });

  describe('Test Framework Detection', () => {
    it('should detect Vitest', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          vitest: '^1.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Vitest');
    });

    it('should detect Jest', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          jest: '^29.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Jest');
    });

    it('should detect Mocha', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          mocha: '^10.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Mocha');
    });

    it('should detect Playwright', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          '@playwright/test': '^1.40.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Playwright');
    });

    it('should detect Cypress', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          cypress: '^13.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Cypress');
    });

    it('should detect pytest for Python', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/requirements.txt`
      );
      mockReadFile.mockResolvedValue('pytest==7.0.0');

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('pytest');
    });

    it('should prioritize Vitest over Jest', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test-project',
        devDependencies: {
          vitest: '^1.0.0',
          jest: '^29.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.testFramework).toBe('Vitest');
    });
  });

  describe('Linter Detection', () => {
    it('should detect ESLint', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          eslint: '^8.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.linter).toBe('ESLint');
    });

    it('should detect Biome', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          '@biomejs/biome': '^1.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.linter).toBe('Biome');
    });

    it('should detect Prettier', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          prettier: '^3.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.formatter).toBe('Prettier');
    });
  });

  describe('Build Tool Detection', () => {
    it('should detect Vite', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          vite: '^5.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.buildTool).toBe('Vite');
    });

    it('should detect Webpack', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          webpack: '^5.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.buildTool).toBe('Webpack');
    });

    it('should detect esbuild', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          esbuild: '^0.20.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.buildTool).toBe('esbuild');
    });

    it('should detect tsup', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/package.json`
      );
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: {
          tsup: '^8.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info.buildTool).toBe('tsup');
    });
  });

  describe('Full Project Analysis', () => {
    it('should detect complete TypeScript/Next.js project', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        if (path === `${testWorkspace}/bun.lock`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({
        name: 'my-nextjs-app',
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0'
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^1.0.0'
        }
      });

      const info = await analyzer.analyze();

      expect(info).toEqual({
        language: 'TypeScript',
        framework: 'Next.js',
        packageManager: 'bun',
        testFramework: 'Vitest'
      });
    });

    it('should detect complete Python/Flask project', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/requirements.txt`
      );
      mockReadFile.mockResolvedValue(`
flask==2.0.0
pytest==7.0.0
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Python');
      expect(info.framework).toBe('Flask');
      expect(info.packageManager).toBe('pip');
      expect(info.testFramework).toBe('pytest');
    });

    it('should detect Rust project', async () => {
      mockPathExists.mockImplementation(async (path: string) =>
        path === `${testWorkspace}/Cargo.toml`
      );
      mockReadFile.mockResolvedValue(`
[package]
name = "my-rust-app"
version = "0.1.0"

[dependencies]
tokio = "1.0"
      `);

      const info = await analyzer.analyze();

      expect(info.language).toBe('Rust');
      expect(info.packageManager).toBe('cargo');
    });

    it('should return empty object for empty workspace', async () => {
      const info = await analyzer.analyze();

      expect(info).toEqual({});
    });
  });
});
