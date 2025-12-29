/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CodeQualityPipeline } from '../../src/core/CodeQualityPipeline';
import * as fs from 'fs-extra';
import * as child_process from 'child_process';

// Mock fs-extra - share references between named and default exports
vi.mock('fs-extra', () => {
  const pathExists = vi.fn();
  const readJson = vi.fn();
  return {
    pathExists,
    readJson,
    default: {
      pathExists,
      readJson
    }
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

describe('CodeQualityPipeline', () => {
  let pipeline: CodeQualityPipeline;
  const mockWorkspace = '/test/workspace';

  beforeEach(() => {
    pipeline = new CodeQualityPipeline();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectScripts()', () => {
    it('returns empty object when package.json not found', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts).toEqual({});
    });

    it('detects lint script', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.lint).toContain('lint');
    });

    it('detects lint:check as alternative', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { 'lint:check': 'eslint --check src/' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.lint).toBeDefined();
    });

    it('detects typecheck script', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { typecheck: 'tsc --noEmit' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.typecheck).toContain('typecheck');
    });

    it('detects type-check as alternative', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { 'type-check': 'tsc --noEmit' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.typecheck).toBeDefined();
    });

    it('detects test script', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.test).toContain('test');
    });

    it('detects build script', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { build: 'tsup src/index.ts' }
      });

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.build).toContain('build');
    });

    it('handles missing scripts section', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({});

      const scripts = await pipeline.detectScripts(mockWorkspace);
      expect(scripts.lint).toBeUndefined();
      expect(scripts.typecheck).toBeUndefined();
      expect(scripts.test).toBeUndefined();
      expect(scripts.build).toBeUndefined();
    });
  });

  describe('run()', () => {
    it('returns passed when all checks succeed', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: {
          lint: 'eslint src/',
          typecheck: 'tsc --noEmit',
          test: 'vitest',
          build: 'tsup'
        }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'All checks passed', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(true);
      expect(result.checks.length).toBe(4);
      expect(result.checks.every(c => c.status === 'passed')).toBe(true);
    });

    it('returns failed when lint fails', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        const error: any = new Error('Lint failed');
        error.code = 1;
        error.stdout = 'src/file.ts: error';
        error.stderr = '';
        callback(error, { stdout: error.stdout, stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'lint')?.status).toBe('failed');
    });

    it('returns failed when typecheck fails', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { typecheck: 'tsc --noEmit' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        const error: any = new Error('Type error');
        error.code = 1;
        error.stdout = 'error TS2345: Argument of type';
        error.stderr = '';
        callback(error, { stdout: error.stdout, stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'typecheck')?.status).toBe('failed');
    });

    it('returns failed when tests fail', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        const error: any = new Error('Test failed');
        error.code = 1;
        error.stdout = '1 test failed';
        error.stderr = '';
        callback(error, { stdout: error.stdout, stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'test')?.status).toBe('failed');
    });

    it('returns failed when build fails', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { build: 'tsup' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        const error: any = new Error('Build failed');
        error.code = 1;
        error.stdout = 'Build error';
        error.stderr = '';
        callback(error, { stdout: error.stdout, stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'build')?.status).toBe('failed');
    });

    it('skips lint when skipLint option is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      const result = await pipeline.run(mockWorkspace, { skipLint: true });

      expect(result.checks.find(c => c.type === 'lint')).toBeUndefined();
    });

    it('skips typecheck when skipTypecheck option is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { typecheck: 'tsc --noEmit' }
      });

      const result = await pipeline.run(mockWorkspace, { skipTypecheck: true });

      expect(result.checks.find(c => c.type === 'typecheck')).toBeUndefined();
    });

    it('skips test when skipTest option is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      const result = await pipeline.run(mockWorkspace, { skipTest: true });

      expect(result.checks.find(c => c.type === 'test')).toBeUndefined();
    });

    it('skips build when skipBuild option is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { build: 'tsup' }
      });

      const result = await pipeline.run(mockWorkspace, { skipBuild: true });

      expect(result.checks.find(c => c.type === 'build')).toBeUndefined();
    });

    it('includes duration for each check', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        setTimeout(() => {
          callback(null, { stdout: 'success', stderr: '' });
        }, 10);
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.checks[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('includes total duration in result', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'success', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await pipeline.run(mockWorkspace);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('applies test filter when provided', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'success', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      await pipeline.run(mockWorkspace, { testFilter: 'auth' });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--grep'),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('formatSummary()', () => {
    it('returns success message when all pass', () => {
      const checks = [
        { type: 'lint' as const, name: 'Lint', command: 'eslint', status: 'passed' as const },
        { type: 'test' as const, name: 'Test', command: 'vitest', status: 'passed' as const }
      ];

      const summary = pipeline.formatSummary(checks);
      expect(summary).toContain('2');
      expect(summary).toContain('passed');
    });

    it('returns failure message when some fail', () => {
      const checks = [
        { type: 'lint' as const, name: 'Lint', command: 'eslint', status: 'passed' as const },
        { type: 'test' as const, name: 'Test', command: 'vitest', status: 'failed' as const }
      ];

      const summary = pipeline.formatSummary(checks);
      expect(summary).toContain('1');
      expect(summary).toContain('failed');
    });
  });

  describe('truncateOutput()', () => {
    it('does not truncate short output', () => {
      const output = 'Short output';
      const truncated = pipeline.truncateOutput(output);
      expect(truncated).toBe(output);
    });

    it('truncates long output', () => {
      const lines = Array(100).fill('line').join('\n');
      const truncated = pipeline.truncateOutput(lines, 50);
      expect(truncated.split('\n').length).toBeLessThan(100);
      expect(truncated).toContain('truncated');
    });

    it('preserves head and tail of output', () => {
      const lines = Array(100).fill(0).map((_, i) => `line-${i}`).join('\n');
      const truncated = pipeline.truncateOutput(lines, 50);
      expect(truncated).toContain('line-0');
      expect(truncated).toContain('line-99');
    });
  });
});
