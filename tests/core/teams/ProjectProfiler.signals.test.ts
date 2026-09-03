/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectProfiler } from '../../../src/core/teams/ProjectProfiler.js';
import {
  countSecretPatterns,
  countUnreferencedExports,
  parseLintOutput,
  parseOutdatedJson,
} from '../../../src/core/teams/profilerSignals.js';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('profiler signal helpers (pure)', () => {
  it('counts exported symbols never referenced by other files', () => {
    const files = new Map([
      ['src/a.ts', 'export function unusedHelper() { return 1; }\nexport const used = 2;'],
      ['src/b.ts', 'import { used } from "./a";\nconsole.log(used);'],
    ]);
    expect(countUnreferencedExports(files)).toBe(1);
  });

  it('counts lint error lines from command output', () => {
    const output = [
      'src/a.ts:1:10 error: unused variable',
      'src/b.ts:3:5 error: missing semicolon',
      '2 problems (0 errors, 2 warnings)',
    ].join('\n');
    expect(parseLintOutput(output)).toBe(2);
  });

  it('parses outdated dependency counts from bun/npm outdated JSON', () => {
    const json = JSON.stringify({
      'react': { current: '18.0.0', latest: '19.0.0' },
      'ink': { current: '4.0.0', latest: '7.0.0' },
    });
    expect(parseOutdatedJson(json)).toBe(2);
  });

  it('counts secret-like patterns in source files', () => {
    const files = new Map([
      ['src/config.ts', 'const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";'],
      ['src/app.ts', 'export const ok = 1;'],
    ]);
    expect(countSecretPatterns(files)).toBe(1);
  });
});

describe('ProjectProfiler expanded signals (fixture repos)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `autohand-signals-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('detects dead-code from unreferenced exports', async () => {
    await fs.ensureDir(path.join(tempDir, 'src'));
    await fs.writeFile(
      path.join(tempDir, 'src', 'a.ts'),
      'export function unusedHelper() { return 1; }\nexport const used = 2;',
    );
    await fs.writeFile(
      path.join(tempDir, 'src', 'b.ts'),
      'import { used } from "./a";\nconsole.log(used);',
    );

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    const signal = profile.signals.find((s) => s.type === 'dead-code');
    expect(signal).toBeDefined();
    expect(signal!.count).toBeGreaterThanOrEqual(1);
  });

  it('detects lint-issues from a failing lint script', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'lint-fixture',
      scripts: {
        lint: 'node -e "console.error(\'src/a.ts:1:10 error: unused variable\'); process.exit(1)"',
      },
    });

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    const signal = profile.signals.find((s) => s.type === 'lint-issues');
    expect(signal).toBeDefined();
    expect(signal!.count).toBeGreaterThanOrEqual(1);
  });

  it('does not emit lint-issues when no lint script exists', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), { name: 'no-lint' });

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.signals.find((s) => s.type === 'lint-issues')).toBeUndefined();
  });

  it('degrades gracefully when stale-deps detection cannot reach a registry', async () => {
    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'stale-fixture',
      dependencies: { react: '^18.0.0' },
    });

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    // Network failures must never block analysis or emit a false signal.
    expect(profile.signals.find((s) => s.type === 'stale-deps')).toBeUndefined();
  });

  it('detects security-concern from secret patterns in source files', async () => {
    await fs.ensureDir(path.join(tempDir, 'src'));
    await fs.writeFile(
      path.join(tempDir, 'src', 'config.ts'),
      'const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";',
    );

    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    const signal = profile.signals.find((s) => s.type === 'security-concern');
    expect(signal).toBeDefined();
    expect(signal!.count).toBeGreaterThanOrEqual(1);
  });

  it('keeps all detection bounded and failure-tolerant', async () => {
    // Empty repo: no signals beyond the structural ones, no throw.
    const profiler = new ProjectProfiler(tempDir);
    const profile = await profiler.analyze();
    expect(profile.signals).toBeDefined();
    expect(profile.analyzedAt).toBeDefined();
  });
});