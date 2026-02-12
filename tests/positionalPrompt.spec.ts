/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for positional prompt argument parsing.
 *
 * Validates that `autohand 'some prompt'` works the same as `autohand -p 'some prompt'`,
 * that -p takes precedence, and that piped stdin works with positional args.
 */
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

/**
 * Build a minimal Commander program that mirrors the positional argument
 * and -p/--prompt option wiring from src/index.ts.
 * Returns the parsed opts so we can assert against them.
 */
function parseArgs(argv: string[]): { prompt?: string; path?: string; positionalPrompt?: string } {
  let captured: { prompt?: string; path?: string; positionalPrompt?: string } = {};

  const program = new Command();
  program
    .name('autohand')
    .argument('[prompt]', 'Run a single instruction in command mode (same as -p)')
    .option('-p, --prompt <text>', 'Run a single instruction in command mode')
    .option('--path <path>', 'Workspace path to operate in')
    .exitOverride()   // throw instead of process.exit on error
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .action((positionalPrompt: string | undefined, opts: { prompt?: string; path?: string }) => {
      if (positionalPrompt && !opts.prompt) {
        opts.prompt = positionalPrompt;
      }
      captured = { ...opts, positionalPrompt };
    });

  program.parse(['node', 'autohand', ...argv]);
  return captured;
}

// ============================================================
// Positional argument
// ============================================================
describe('Positional prompt argument', () => {
  it('accepts a positional argument as the prompt', () => {
    const result = parseArgs(['explain these changes']);
    expect(result.prompt).toBe('explain these changes');
    expect(result.positionalPrompt).toBe('explain these changes');
  });

  it('accepts -p flag as the prompt', () => {
    const result = parseArgs(['-p', 'explain these changes']);
    expect(result.prompt).toBe('explain these changes');
    expect(result.positionalPrompt).toBeUndefined();
  });

  it('accepts --prompt flag as the prompt', () => {
    const result = parseArgs(['--prompt', 'review this code']);
    expect(result.prompt).toBe('review this code');
    expect(result.positionalPrompt).toBeUndefined();
  });

  it('-p flag takes precedence over positional argument', () => {
    const result = parseArgs(['-p', 'from flag', 'from positional']);
    expect(result.prompt).toBe('from flag');
  });

  it('--prompt flag takes precedence over positional argument', () => {
    const result = parseArgs(['from positional', '--prompt', 'from flag']);
    expect(result.prompt).toBe('from flag');
  });

  it('no prompt and no positional leaves prompt undefined', () => {
    const result = parseArgs([]);
    expect(result.prompt).toBeUndefined();
    expect(result.positionalPrompt).toBeUndefined();
  });

  it('positional argument works with --path flag', () => {
    const result = parseArgs(['refactor this file', '--path', 'src/foo.ts']);
    expect(result.prompt).toBe('refactor this file');
    expect(result.path).toBe('src/foo.ts');
  });

  it('positional argument works with --path before it', () => {
    const result = parseArgs(['--path', 'src/bar.ts', 'add error handling']);
    expect(result.prompt).toBe('add error handling');
    expect(result.path).toBe('src/bar.ts');
  });

  it('-p flag works with --path flag', () => {
    const result = parseArgs(['-p', 'fix the bug', '--path', 'src/index.ts']);
    expect(result.prompt).toBe('fix the bug');
    expect(result.path).toBe('src/index.ts');
  });

  it('handles prompt with special characters', () => {
    const result = parseArgs(['explain the `async/await` pattern']);
    expect(result.prompt).toBe('explain the `async/await` pattern');
  });

  it('handles prompt with quotes in content', () => {
    const result = parseArgs(['fix the "TypeError" in auth.ts']);
    expect(result.prompt).toBe('fix the "TypeError" in auth.ts');
  });

  it('handles multi-word prompt correctly', () => {
    const result = parseArgs(['add input validation to the login form and show error messages']);
    expect(result.prompt).toBe('add input validation to the login form and show error messages');
  });
});

// ============================================================
// buildPipePrompt with positional args
// ============================================================
describe('buildPipePrompt with positional prompt', () => {
  it('combines piped content with positional prompt', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    // Simulates: git diff | autohand 'explain these changes'
    const pipedInput = 'diff --git a/file.ts\n-old\n+new';
    const result = buildPipePrompt('explain these changes', pipedInput);

    expect(result).toContain('explain these changes');
    expect(result).toContain('diff --git a/file.ts');
    expect(result).toContain('```');
  });

  it('works with positional prompt when no pipe input', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    // Simulates: autohand 'refactor this file'
    const result = buildPipePrompt('refactor this file', null);

    expect(result).toBe('refactor this file');
  });

  it('preserves full diff content in fenced block', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const pipedInput = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      'index abc123..def456 100644',
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '@@ -10,3 +10,5 @@',
      '-const token = getToken();',
      '+const token = await getToken();',
      '+if (!token) throw new AuthError();',
    ].join('\n');

    const result = buildPipePrompt('review for security issues', pipedInput);

    expect(result).toContain('review for security issues');
    expect(result).toContain('diff --git a/src/auth.ts');
    expect(result).toContain('+const token = await getToken();');
    expect(result).toContain('+if (!token) throw new AuthError();');
    expect(result).toContain('```');
    // Verify structure: stdin block comes before the prompt
    const blockStart = result.indexOf('```');
    const promptStart = result.indexOf('review for security issues');
    expect(blockStart).toBeLessThan(promptStart);
  });

  it('handles git log piped content', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const pipedInput = [
      'abc1234 feat: add user auth',
      'def5678 fix: resolve race condition',
      'ghi9012 refactor: extract utils',
    ].join('\n');

    const result = buildPipePrompt('summarize recent changes', pipedInput);

    expect(result).toContain('summarize recent changes');
    expect(result).toContain('feat: add user auth');
    expect(result).toContain('fix: resolve race condition');
  });

  it('handles file content piped input', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    // Simulates: cat src/auth.ts | autohand 'review this code'
    const pipedInput = 'export function login(user: string, pass: string) {\n  return fetch("/api/login");\n}';
    const result = buildPipePrompt('review this code for security issues', pipedInput);

    expect(result).toContain('review this code for security issues');
    expect(result).toContain('export function login');
    expect(result).toContain('```');
  });
});
