/**
 * PatternDetector Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { PatternDetector } from '../src/core/PatternDetector.js';

describe('PatternDetector', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `pattern-detector-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('detectTechStack', () => {
    it('should detect TypeScript from package.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        devDependencies: { typescript: '^5.0.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('TypeScript');
      expect(patterns.techStack).toContain('Node.js');
    });

    it('should detect React from package.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        dependencies: { react: '^18.2.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('React');
    });

    it('should detect TypeScript from tsconfig.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {});
      await fs.writeJSON(path.join(tempDir, 'tsconfig.json'), {
        compilerOptions: { strict: true },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('TypeScript');
    });

    it('should detect Rust from Cargo.toml', async () => {
      await fs.writeFile(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('Rust');
    });

    it('should detect Go from go.mod', async () => {
      await fs.writeFile(path.join(tempDir, 'go.mod'), 'module test');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('Go');
    });

    it('should detect Python from pyproject.toml', async () => {
      await fs.writeFile(path.join(tempDir, 'pyproject.toml'), '[project]\nname = "test"');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('Python');
    });

    it('should detect Vitest testing framework', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        devDependencies: { vitest: '^1.0.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.techStack).toContain('Vitest');
    });
  });

  describe('detectCommands', () => {
    it('should detect test command from package.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        scripts: { test: 'vitest' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.testCommand).toBe('npm run test');
    });

    it('should detect build command from package.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        scripts: { build: 'tsc' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.buildCommand).toBe('npm run build');
    });

    it('should detect lint command from package.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        scripts: { lint: 'eslint .' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.lintCommand).toBe('npm run lint');
    });

    it('should use bun run for bun projects', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        scripts: { test: 'vitest' },
      });
      await fs.writeFile(path.join(tempDir, 'bun.lockb'), '');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.testCommand).toBe('bun test');
      expect(patterns.packageManager).toBe('bun');
    });

    it('should detect cargo commands for Rust', async () => {
      await fs.writeFile(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.testCommand).toBe('cargo test');
      expect(patterns.buildCommand).toBe('cargo build');
      expect(patterns.lintCommand).toBe('cargo clippy');
    });

    it('should detect go commands for Go', async () => {
      await fs.writeFile(path.join(tempDir, 'go.mod'), 'module test');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.testCommand).toBe('go test ./...');
      expect(patterns.buildCommand).toBe('go build');
    });
  });

  describe('detectFramework', () => {
    it('should detect Next.js', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        dependencies: { next: '14.0.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.framework).toBe('Next.js 14');
    });

    it('should detect Express', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        dependencies: { express: '^4.18.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.framework).toBe('Express');
    });

    it('should detect Astro', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {
        dependencies: { astro: '^4.0.0' },
      });

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.framework).toBe('Astro');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect npm from package-lock.json', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {});
      await fs.writeJSON(path.join(tempDir, 'package-lock.json'), {});

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.packageManager).toBe('npm');
    });

    it('should detect yarn from yarn.lock', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {});
      await fs.writeFile(path.join(tempDir, 'yarn.lock'), '');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.packageManager).toBe('yarn');
    });

    it('should detect pnpm from pnpm-lock.yaml', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {});
      await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), '');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.packageManager).toBe('pnpm');
    });

    it('should detect bun from bun.lockb', async () => {
      await fs.writeJSON(path.join(tempDir, 'package.json'), {});
      await fs.writeFile(path.join(tempDir, 'bun.lockb'), '');

      const detector = new PatternDetector(tempDir);
      const patterns = await detector.detect();

      expect(patterns.packageManager).toBe('bun');
    });
  });
});
