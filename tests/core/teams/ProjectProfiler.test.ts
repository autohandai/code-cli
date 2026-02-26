/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectProfiler } from '../../../src/core/teams/ProjectProfiler.js';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('ProjectProfiler', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `autohand-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('should detect languages from package.json', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), { name: 'test' });
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.languages).toContain('typescript');
  });

  it('should detect missing docs', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), { name: 'test' });
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    const docsSignal = profile.signals.find((s) => s.type === 'missing-docs');
    expect(docsSignal).toBeDefined();
  });

  it('should detect TODOs in source files', async () => {
    await fs.ensureDir(path.join(tempDir, 'src'));
    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), '// TODO: fix this\n// FIXME: broken\n');

    // Initialize a git repo so git ls-files works
    const { execSync } = await import('node:child_process');
    execSync('git init && git add .', { cwd: tempDir, stdio: 'ignore' });

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    const todoSignal = profile.signals.find((s) => s.type === 'todo');
    expect(todoSignal).toBeDefined();
    expect(todoSignal!.count).toBeGreaterThanOrEqual(2);
  });

  it('should detect docs/ directory exists', async () => {
    await fs.ensureDir(path.join(tempDir, 'docs'));
    await fs.writeFile(path.join(tempDir, 'docs', 'readme.md'), '# Docs');
    await fs.writeJson(path.join(tempDir, 'package.json'), { name: 'test' });
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.structure.hasDocs).toBe(true);
  });

  it('should return valid ProjectProfile shape', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), { name: 'test' });
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.repoRoot).toBe(tempDir);
    expect(Array.isArray(profile.languages)).toBe(true);
    expect(Array.isArray(profile.signals)).toBe(true);
    expect(profile.analyzedAt).toBeDefined();
  });

  it('should detect frameworks from package.json deps', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'test',
      dependencies: { react: '^18.0.0', ink: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    });
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.frameworks).toContain('react');
    expect(profile.frameworks).toContain('ink');
    expect(profile.frameworks).toContain('vitest');
  });
});
