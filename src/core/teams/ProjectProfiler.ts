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

const execFileAsync = promisify(execFile);

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
   * Gather project signals: TODOs, missing docs, missing tests.
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

    return signals;
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
        ['ls-files', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.rs', '*.go'],
        {
          cwd: this.repoRoot,
          encoding: 'utf-8',
          timeout: 5000,
        },
      );
      const files = stdout.trim().split('\n').filter(Boolean);

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
