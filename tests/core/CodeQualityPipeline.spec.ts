/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CodeQualityPipeline } from '../../src/core/CodeQualityPipeline';
import * as fs from 'fs-extra';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

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

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

function createMockProcess(exitCode: number, stdout = '', stderr = ''): EventEmitter {
  const emitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  // @ts-expect-error - mock EventEmitter with stream-like behavior
  emitter.stdout = stdoutEmitter;
  // @ts-expect-error
  emitter.stderr = stderrEmitter;
  // @ts-expect-error
  emitter.killed = false;
  // @ts-expect-error
  emitter.kill = vi.fn(() => { emitter.killed = true; return true; });

  // Defer close emission to next tick so listeners are registered
  setImmediate(() => {
    if (stdout) {
      stdoutEmitter.emit('data', Buffer.from(stdout));
    }
    if (stderr) {
      stderrEmitter.emit('data', Buffer.from(stderr));
    }
    emitter.emit('close', exitCode);
  });

  return emitter;
}

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

      const mockSpawn = vi.fn(() => createMockProcess(0, 'All checks passed'));
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

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

      vi.mocked(spawn).mockImplementation(() => createMockProcess(1, 'src/file.ts: error'));

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'lint')?.status).toBe('failed');
    });

    it('returns failed when typecheck fails', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { typecheck: 'tsc --noEmit' }
      });

      vi.mocked(spawn).mockImplementation(() => createMockProcess(1, 'error TS2345: Argument of type'));

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'typecheck')?.status).toBe('failed');
    });

    it('returns failed when tests fail', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      vi.mocked(spawn).mockImplementation(() => createMockProcess(1, '1 test failed'));

      const result = await pipeline.run(mockWorkspace);

      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.type === 'test')?.status).toBe('failed');
    });

    it('returns failed when build fails', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { build: 'tsup' }
      });

      vi.mocked(spawn).mockImplementation(() => createMockProcess(1, 'Build error'));

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

      vi.mocked(spawn).mockImplementation(() => createMockProcess(0, 'success'));

      const result = await pipeline.run(mockWorkspace);

      expect(result.checks[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('includes total duration in result', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { lint: 'eslint src/' }
      });

      vi.mocked(spawn).mockImplementation(() => createMockProcess(0, 'success'));

      const result = await pipeline.run(mockWorkspace);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('applies test filter when provided', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        scripts: { test: 'vitest' }
      });

      const mockSpawn = vi.fn(() => createMockProcess(0, 'success'));
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      await pipeline.run(mockWorkspace, { testFilter: 'auth' });

      expect(mockSpawn).toHaveBeenCalled();
      const callArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(callArgs[1]).toContain('--grep');
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
