/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Quality check types
 */
export type QualityCheckType = 'lint' | 'typecheck' | 'test' | 'build';

/**
 * Quality check status
 */
export type QualityCheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/**
 * Individual quality check result
 */
export interface QualityCheck {
  type: QualityCheckType;
  name: string;
  command: string;
  status: QualityCheckStatus;
  duration?: number;
  output?: string;
  exitCode?: number;
}

/**
 * Detected quality scripts from package.json
 */
export interface QualityScripts {
  lint?: string;
  typecheck?: string;
  test?: string;
  build?: string;
}

/**
 * Full quality pipeline result
 */
export interface QualityResult {
  passed: boolean;
  checks: QualityCheck[];
  duration: number;
  summary: string;
}

/**
 * Quality pipeline options
 */
export interface QualityOptions {
  skipLint?: boolean;
  skipTypecheck?: boolean;
  skipTest?: boolean;
  skipBuild?: boolean;
  autoFix?: boolean;
  testFilter?: string;
}

/**
 * Script name alternatives for detection
 */
interface ScriptAlternatives {
  primary: string;
  alternatives: string[];
}

/**
 * Runs code quality checks after file modifications.
 * Auto-detects lint, typecheck, test, and build scripts from package.json.
 */
export class CodeQualityPipeline {
  /**
   * Script detection patterns
   */
  private readonly scriptPatterns: Record<QualityCheckType, ScriptAlternatives> = {
    lint: { primary: 'lint', alternatives: ['lint:check', 'eslint'] },
    typecheck: { primary: 'typecheck', alternatives: ['type-check', 'tsc', 'types', 'check:types'] },
    test: { primary: 'test', alternatives: ['test:unit', 'vitest', 'jest'] },
    build: { primary: 'build', alternatives: ['build:prod', 'compile'] },
  };

  /**
   * Default timeout for checks (5 minutes)
   */
  private readonly defaultTimeout = 300000;

  /**
   * Run full quality pipeline
   * @param workspaceRoot - Root directory of the workspace
   * @param options - Pipeline options
   * @returns Quality result with all checks
   */
  async run(workspaceRoot: string, options?: QualityOptions): Promise<QualityResult> {
    const startTime = Date.now();
    const scripts = await this.detectScripts(workspaceRoot);
    const checks: QualityCheck[] = [];

    // Auto-fix lint errors first
    if (options?.autoFix && scripts.lint) {
      await this.runAutoFix(workspaceRoot, scripts.lint);
    }

    // Run lint + typecheck in parallel (they're independent)
    const parallelChecks: Promise<QualityCheck>[] = [];

    if (scripts.lint && !options?.skipLint) {
      parallelChecks.push(this.runCheck(workspaceRoot, 'lint', 'Lint', scripts.lint));
    }
    if (scripts.typecheck && !options?.skipTypecheck) {
      parallelChecks.push(this.runCheck(workspaceRoot, 'typecheck', 'Types', scripts.typecheck));
    }

    // Wait for parallel checks
    if (parallelChecks.length > 0) {
      const parallelResults = await Promise.all(parallelChecks);
      checks.push(...parallelResults);
    }

    // Run test (sequential - may depend on types being correct)
    if (scripts.test && !options?.skipTest) {
      let testCmd = scripts.test;
      if (options?.testFilter) {
        testCmd = `${scripts.test} --grep "${options.testFilter}"`;
      }
      checks.push(await this.runCheck(workspaceRoot, 'test', 'Tests', testCmd));
    }

    // Run build (sequential - depends on all above)
    if (scripts.build && !options?.skipBuild) {
      checks.push(await this.runCheck(workspaceRoot, 'build', 'Build', scripts.build));
    }

    const passed = checks.every((c) => c.status === 'passed' || c.status === 'skipped');

    return {
      passed,
      checks,
      duration: Date.now() - startTime,
      summary: this.formatSummary(checks),
    };
  }

  /**
   * Detect available quality scripts from package.json
   * @param root - Workspace root directory
   * @returns Detected scripts
   */
  async detectScripts(root: string): Promise<QualityScripts> {
    const pkgPath = join(root, 'package.json');

    if (!(await fs.pathExists(pkgPath))) {
      return {};
    }

    try {
      const pkg = await fs.readJson(pkgPath);
      const scripts = pkg.scripts || {};

      return {
        lint: this.findScript(scripts, this.scriptPatterns.lint),
        typecheck: this.findScript(scripts, this.scriptPatterns.typecheck),
        test: this.findScript(scripts, this.scriptPatterns.test),
        build: this.findScript(scripts, this.scriptPatterns.build),
      };
    } catch {
      return {};
    }
  }

  /**
   * Find script by primary name or alternatives
   */
  private findScript(
    scripts: Record<string, string>,
    pattern: ScriptAlternatives
  ): string | undefined {
    // Check primary first
    if (scripts[pattern.primary]) {
      return pattern.primary;
    }

    // Check alternatives
    for (const alt of pattern.alternatives) {
      if (scripts[alt]) {
        return alt;
      }
    }

    return undefined;
  }

  /**
   * Run a single quality check
   */
  private async runCheck(
    root: string,
    type: QualityCheckType,
    name: string,
    scriptName: string
  ): Promise<QualityCheck> {
    // Build the actual command (use npm run by default)
    const command = `npm run ${scriptName}`;

    const check: QualityCheck = {
      type,
      name,
      command,
      status: 'running',
    };

    const start = Date.now();

    try {
      const result = await execAsync(command, {
        cwd: root,
        timeout: this.defaultTimeout,
      });

      check.status = 'passed';
      check.output = this.truncateOutput(result.stdout + result.stderr);
      check.exitCode = 0;
    } catch (error: unknown) {
      check.status = 'failed';
      if (error && typeof error === 'object') {
        const execError = error as { stdout?: string; stderr?: string; code?: number };
        check.output = this.truncateOutput((execError.stdout || '') + (execError.stderr || ''));
        check.exitCode = execError.code || 1;
      } else {
        check.output = String(error);
        check.exitCode = 1;
      }
    }

    check.duration = Date.now() - start;
    return check;
  }

  /**
   * Run lint auto-fix before checking
   */
  private async runAutoFix(root: string, lintScript: string): Promise<void> {
    // Try common fix script patterns
    const fixScripts = [
      lintScript.replace('lint', 'lint:fix'),
      lintScript.replace('lint:check', 'lint:fix'),
      `${lintScript} --fix`,
    ];

    for (const fixScript of fixScripts) {
      try {
        await execAsync(`npm run ${fixScript}`, { cwd: root, timeout: 60000 });
        return; // Success, stop trying
      } catch {
        // Try next pattern
      }
    }
  }

  /**
   * Truncate long output to prevent overwhelming display
   * @param output - Command output
   * @param maxLines - Maximum lines to keep
   * @returns Truncated output
   */
  truncateOutput(output: string, maxLines = 50): string {
    if (!output) return '';

    const lines = output.split('\n');
    if (lines.length <= maxLines) {
      return output;
    }

    const headCount = Math.floor(maxLines / 2);
    const tailCount = maxLines - headCount;

    const head = lines.slice(0, headCount);
    const tail = lines.slice(-tailCount);
    const omitted = lines.length - headCount - tailCount;

    return [...head, `\n... (${omitted} lines truncated) ...\n`, ...tail].join('\n');
  }

  /**
   * Format summary of quality checks
   * @param checks - Quality check results
   * @returns Summary string
   */
  formatSummary(checks: QualityCheck[]): string {
    const passed = checks.filter((c) => c.status === 'passed').length;
    const failed = checks.filter((c) => c.status === 'failed').length;
    const total = checks.length;

    if (total === 0) {
      return 'No quality checks configured';
    }

    if (failed === 0) {
      return `${passed} passed`;
    }

    return `${failed} failed, ${passed} passed`;
  }

  /**
   * Format quality result for display
   * @param result - Quality result
   * @returns Formatted string for terminal display
   */
  formatDisplay(result: QualityResult): string {
    const lines: string[] = ['[QUALITY] Running Gates'];

    for (let i = 0; i < result.checks.length; i++) {
      const check = result.checks[i];
      const isLast = i === result.checks.length - 1;
      const prefix = isLast ? '  \\-- ' : '  |-- ';

      let status: string;
      switch (check.status) {
        case 'passed':
          status = '[OK]';
          break;
        case 'failed':
          status = '[FAIL]';
          break;
        case 'skipped':
          status = '[SKIP]';
          break;
        default:
          status = '[...]';
      }

      const duration = check.duration ? `(${(check.duration / 1000).toFixed(1)}s)` : '';
      lines.push(`${prefix}${status} ${check.name.padEnd(8)} ${check.command.padEnd(20)} ${duration}`);

      // Show first few lines of error output
      if (check.status === 'failed' && check.output) {
        const errorLines = check.output.split('\n').slice(0, 3);
        for (const line of errorLines) {
          if (line.trim()) {
            lines.push(`      ${line}`);
          }
        }
      }
    }

    // Add summary
    lines.push('');
    if (result.passed) {
      lines.push(`[PASS] ${result.summary} (${(result.duration / 1000).toFixed(1)}s)`);
    } else {
      lines.push(`[FAIL] ${result.summary}`);
    }

    return lines.join('\n');
  }
}
