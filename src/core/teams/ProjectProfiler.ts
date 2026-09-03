/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs-extra';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectProfile, ProjectSignal } from './types.js';
import {
  countSecretPatterns,
  countUnreferencedExports,
  parseLintOutput,
  parseOutdatedJson,
} from './profilerSignals.js';

const execFileAsync = promisify(execFile);
const MAX_SIGNAL_FILES = 200;
const SIGNAL_TIMEOUT_MS = 5000;

/**
 * ProjectProfiler scans a git repository to detect languages, frameworks,
 * TODOs, documentation/test coverage gaps, and generates project signals
 * that drive agent creation for team formation.
 */
export class ProjectProfiler {
  constructor(private readonly repoRoot: string) {}

  /**
   * Perform a full analysis of the repository and return a ProjectProfile.
   */
  async analyze(): Promise<ProjectProfile> {
    const [languages, frameworks, structure, signals] = await Promise.all([
      this.detectLanguages(),
      this.detectFrameworks(),
      this.detectStructure(),
      this.detectSignals(),
    ]);

    return {
      repoRoot: this.repoRoot,
      languages,
      frameworks,
      structure,
      signals,
      generatedAgents: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect programming languages by checking for well-known project manifest files.
   */
  private async detectLanguages(): Promise<string[]> {
    const langs: string[] = [];
    const checks: [string, string][] = [
      ['package.json', 'typescript'],
      ['tsconfig.json', 'typescript'],
      ['Cargo.toml', 'rust'],
      ['go.mod', 'go'],
      ['pyproject.toml', 'python'],
      ['requirements.txt', 'python'],
      ['Gemfile', 'ruby'],
      ['pom.xml', 'java'],
      ['build.gradle', 'java'],
    ];

    for (const [file, lang] of checks) {
      if (await fs.pathExists(path.join(this.repoRoot, file))) {
        if (!langs.includes(lang)) langs.push(lang);
      }
    }

    if (langs.length === 0) langs.push('unknown');
    return langs;
  }

  /**
   * Detect frameworks by inspecting package.json dependencies and devDependencies.
   */
  private async detectFrameworks(): Promise<string[]> {
    const frameworks: string[] = [];
    const pkgPath = path.join(this.repoRoot, 'package.json');

    if (await fs.pathExists(pkgPath)) {
      try {
        const pkg = await fs.readJson(pkgPath);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const known = [
          'react',
          'vue',
          'angular',
          'express',
          'fastify',
          'next',
          'ink',
          'commander',
          'vitest',
          'jest',
        ];
        for (const fw of known) {
          if (allDeps[fw]) frameworks.push(fw);
        }
      } catch {
        /* ignore parse errors */
      }
    }

    return frameworks;
  }

  /**
   * Detect repository structure: presence of docs, tests, and CI configuration.
   */
  private async detectStructure(): Promise<{ hasDocs: boolean; hasTests: boolean; hasCI: boolean }> {
    const [hasDocs, hasTests, hasCI] = await Promise.all([
      fs.pathExists(path.join(this.repoRoot, 'docs')),
      this.anyPathExists([
        path.join(this.repoRoot, 'tests'),
        path.join(this.repoRoot, 'test'),
        path.join(this.repoRoot, '__tests__'),
      ]),
      this.anyPathExists([
        path.join(this.repoRoot, '.github', 'workflows'),
        path.join(this.repoRoot, '.circleci'),
        path.join(this.repoRoot, '.gitlab-ci.yml'),
      ]),
    ]);

    return { hasDocs, hasTests, hasCI };
  }

  /**
   * Gather project signals: TODOs, missing docs, missing tests, dead code,
   * lint issues, stale deps, and security concerns. All detection is bounded
   * and failure-tolerant: a failed probe degrades to "no signal".
   */
  private async detectSignals(): Promise<ProjectSignal[]> {
    const signals: ProjectSignal[] = [];

    const todos = await this.scanTodos();
    if (todos.count > 0) {
      signals.push(todos);
    }

    const hasDocs = await fs.pathExists(path.join(this.repoRoot, 'docs'));
    if (!hasDocs) {
      signals.push({
        type: 'missing-docs',
        severity: 'medium',
        count: 1,
        locations: [],
      });
    }

    const hasTests = await this.anyPathExists([
      path.join(this.repoRoot, 'tests'),
      path.join(this.repoRoot, 'test'),
      path.join(this.repoRoot, '__tests__'),
    ]);
    if (!hasTests) {
      signals.push({
        type: 'missing-tests',
        severity: 'medium',
        count: 1,
        locations: [],
      });
    }

    const [deadCode, lintIssues, staleDeps, securityConcern] = await Promise.all([
      this.detectDeadCode(),
      this.detectLintIssues(),
      this.detectStaleDeps(),
      this.detectSecurityConcern(),
    ]);
    for (const signal of [deadCode, lintIssues, staleDeps, securityConcern]) {
      if (signal) signals.push(signal);
    }

    return signals;
  }

  /** Best-effort dead-code detection: exported symbols never referenced elsewhere. */
  private async detectDeadCode(): Promise<ProjectSignal | undefined> {
    try {
      const files = await this.readSourceFiles();
      const count = countUnreferencedExports(files);
      if (count === 0) return undefined;
      return {
        type: 'dead-code',
        severity: count > 10 ? 'high' : count > 3 ? 'medium' : 'low',
        count,
        locations: [...files.keys()].slice(0, 10),
      };
    } catch {
      return undefined;
    }
  }

  /** Best-effort lint detection: run the repo's lint script with a bounded timeout. */
  private async detectLintIssues(): Promise<ProjectSignal | undefined> {
    const pkgPath = path.join(this.repoRoot, 'package.json');
    if (!(await fs.pathExists(pkgPath))) return undefined;
    let lintScript: string | undefined;
    try {
      const pkg = await fs.readJson(pkgPath);
      lintScript = pkg.scripts?.lint;
    } catch {
      return undefined;
    }
    if (typeof lintScript !== 'string' || !lintScript.trim()) return undefined;

    try {
      const { stdout, stderr } = await execFileAsync(
        'bun',
        ['run', 'lint'],
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: SIGNAL_TIMEOUT_MS },
      );
      const count = parseLintOutput(`${stdout}\n${stderr}`);
      if (count === 0) return undefined;
      return {
        type: 'lint-issues',
        severity: count > 20 ? 'high' : count > 5 ? 'medium' : 'low',
        count,
        locations: [],
      };
    } catch (error) {
      // A failing lint script exits non-zero; parse its output for issues.
      const output = error instanceof Error ? error.message : String(error);
      const count = parseLintOutput(output);
      if (count === 0) return undefined;
      return {
        type: 'lint-issues',
        severity: count > 20 ? 'high' : count > 5 ? 'medium' : 'low',
        count,
        locations: [],
      };
    }
  }

  /** Best-effort stale-deps detection via bun outdated --json (bounded). */
  private async detectStaleDeps(): Promise<ProjectSignal | undefined> {
    const pkgPath = path.join(this.repoRoot, 'package.json');
    if (!(await fs.pathExists(pkgPath))) return undefined;
    try {
      const { stdout } = await execFileAsync(
        'bun',
        ['outdated', '--json'],
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: SIGNAL_TIMEOUT_MS },
      );
      const count = parseOutdatedJson(stdout);
      if (count === 0) return undefined;
      return {
        type: 'stale-deps',
        severity: count > 10 ? 'high' : count > 3 ? 'medium' : 'low',
        count,
        locations: [],
      };
    } catch {
      return undefined;
    }
  }

  /** Best-effort security-concern detection: secret-like patterns in source files. */
  private async detectSecurityConcern(): Promise<ProjectSignal | undefined> {
    try {
      const files = await this.readSourceFiles();
      const count = countSecretPatterns(files);
      if (count === 0) return undefined;
      return {
        type: 'security-concern',
        severity: 'low',
        count,
        locations: [...files.keys()].slice(0, 10),
      };
    } catch {
      return undefined;
    }
  }

  /** Read up to MAX_SIGNAL_FILES tracked source files into a path → content map. */
  private async readSourceFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go']);
    let tracked: string[] = [];
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files'],
        { cwd: this.repoRoot, encoding: 'utf-8', timeout: SIGNAL_TIMEOUT_MS },
      );
      tracked = stdout
        .trim()
        .split('\n')
        .filter((f) => f && sourceExtensions.has(path.extname(f)));
    } catch {
      // Not a git repo (or git unavailable): fall back to a bounded filesystem
      // walk so the profiler still works in plain directories.
      tracked = await this.walkSourceFiles(sourceExtensions);
    }
    for (const file of tracked.slice(0, MAX_SIGNAL_FILES)) {
      try {
        files.set(file, await fs.readFile(path.join(this.repoRoot, file), 'utf-8'));
      } catch {
        /* skip unreadable files */
      }
    }
    return files;
  }

  /** Bounded recursive walk for source files when git ls-files is unavailable. */
  private async walkSourceFiles(extensions: Set<string>): Promise<string[]> {
    const results: string[] = [];
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
    const visit = async (dir: string): Promise<void> => {
      if (results.length >= MAX_SIGNAL_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_SIGNAL_FILES) return;
        if (ignored.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(full);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
          results.push(path.relative(this.repoRoot, full));
        }
      }
    };
    await visit(this.repoRoot);
    return results;
  }

  /**
   * Scan tracked source files for TODO/FIXME/HACK/XXX markers using git ls-files.
   */
  private async scanTodos(): Promise<ProjectSignal> {
    const locations: string[] = [];
    let count = 0;

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files'],
        {
          cwd: this.repoRoot,
          encoding: 'utf-8',
          timeout: 5000,
        },
      );
      const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go']);
      const files = stdout
        .trim()
        .split('\n')
        .filter((f) => f && sourceExtensions.has(path.extname(f)));

      for (const file of files.slice(0, 200)) {
        try {
          const content = await fs.readFile(path.join(this.repoRoot, file), 'utf-8');
          const matches = content.match(/\b(TODO|FIXME|HACK|XXX)\b/g);
          if (matches) {
            count += matches.length;
            if (locations.length < 10) locations.push(file);
          }
        } catch {
          /* skip unreadable files */
        }
      }
    } catch {
      /* git not available or no tracked files */
    }

    return {
      type: 'todo',
      severity: count > 20 ? 'high' : count > 5 ? 'medium' : 'low',
      count,
      locations,
    };
  }

  /**
   * Check whether any of the given paths exist.
   * Unlike Promise.any with fs.pathExists (which always resolves),
   * this properly returns true if at least one path exists.
   */
  private async anyPathExists(paths: string[]): Promise<boolean> {
    const results = await Promise.all(paths.map((p) => fs.pathExists(p)));
    return results.some(Boolean);
  }
}
