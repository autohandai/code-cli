/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for positional prompt argument with real subprocesses.
 *
 * Spawns a minimal script that mirrors the positional argument + pipe wiring
 * from src/index.ts, then verifies behavior through actual shell invocations.
 *
 * Uses process.argv directly (not Commander) to avoid module resolution issues
 * in temp directories. The argument parsing logic mirrors what Commander does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '../..');
let tempDir: string;
let scriptPath: string;

/**
 * Script that reads argv and stdin, applies the same merging logic as index.ts.
 * Accepts: [positional] [-p <prompt>] [--path <path>]
 */
function buildTestScript(): string {
  const srcRoot = path.join(ROOT, 'src');
  return `
import { detectStdinType, readPipedStdin } from '${srcRoot}/utils/stdinDetector.js';
import { buildPipePrompt } from '${srcRoot}/modes/pipeMode.js';

async function main() {
  // Parse argv manually to mirror Commander behavior
  const args = process.argv.slice(2);
  let positionalPrompt = null;
  let flagPrompt = null;
  let pathArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--prompt') {
      flagPrompt = args[++i];
    } else if (args[i] === '--path') {
      pathArg = args[++i];
    } else if (!args[i].startsWith('-')) {
      positionalPrompt = args[i];
    }
  }

  // Mirror index.ts logic: positional fills prompt when -p is absent
  let prompt = flagPrompt;
  if (positionalPrompt && !flagPrompt) {
    prompt = positionalPrompt;
  }

  let pipedInput = null;
  let instruction = prompt;

  const stdinType = detectStdinType();
  if (stdinType === 'pipe' && prompt) {
    pipedInput = await readPipedStdin();
    instruction = buildPipePrompt(prompt, pipedInput);
  }

  process.stdout.write(JSON.stringify({
    positionalPrompt,
    flagPrompt,
    prompt,
    path: pathArg,
    stdinType,
    pipedInput,
    instruction,
  }));
}

main().catch(err => {
  process.stderr.write(String(err));
  process.exit(1);
});
`;
}

describe('Positional prompt integration', () => {
  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-pos-test-'));
    scriptPath = path.join(tempDir, 'pos-test.ts');
    await fs.writeFile(scriptPath, buildTestScript());
  });

  afterAll(async () => {
    await fs.remove(tempDir);
  });

  function run(shellCmd: string): Record<string, unknown> {
    const result = execSync(shellCmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    return JSON.parse(result.trim());
  }

  // ---- Positional argument ----

  it('accepts positional argument as prompt', () => {
    const parsed = run(`npx tsx "${scriptPath}" "explain these changes"`);
    expect(parsed.prompt).toBe('explain these changes');
    expect(parsed.positionalPrompt).toBe('explain these changes');
  });

  it('accepts -p flag as prompt', () => {
    const parsed = run(`npx tsx "${scriptPath}" -p "explain these changes"`);
    expect(parsed.prompt).toBe('explain these changes');
    expect(parsed.positionalPrompt).toBeNull();
  });

  it('-p flag takes precedence over positional', () => {
    const parsed = run(`npx tsx "${scriptPath}" "from positional" -p "from flag"`);
    expect(parsed.prompt).toBe('from flag');
  });

  it('no arguments leaves prompt null', () => {
    const parsed = run(`npx tsx "${scriptPath}"`);
    expect(parsed.prompt).toBeNull();
    expect(parsed.positionalPrompt).toBeNull();
  });

  // ---- With --path flag ----

  it('positional argument works with --path', () => {
    const parsed = run(`npx tsx "${scriptPath}" "refactor this file" --path src/foo.ts`);
    expect(parsed.prompt).toBe('refactor this file');
    expect(parsed.path).toBe('src/foo.ts');
  });

  it('-p flag works with --path', () => {
    const parsed = run(`npx tsx "${scriptPath}" -p "fix the bug" --path src/index.ts`);
    expect(parsed.prompt).toBe('fix the bug');
    expect(parsed.path).toBe('src/index.ts');
  });

  // ---- Pipe + positional ----

  it('pipe stdin combines with positional prompt', () => {
    const parsed = run(`printf 'diff --git a/file.ts\\n-old\\n+new' | npx tsx "${scriptPath}" "explain these changes"`);
    expect(parsed.stdinType).toBe('pipe');
    expect(parsed.pipedInput).toContain('diff --git a/file.ts');
    expect(parsed.instruction).toContain('explain these changes');
    expect(parsed.instruction).toContain('```');
  });

  it('pipe stdin combines with -p flag', () => {
    const parsed = run(`printf 'diff --git a/file.ts\\n-old\\n+new' | npx tsx "${scriptPath}" -p "explain these changes"`);
    expect(parsed.stdinType).toBe('pipe');
    expect(parsed.pipedInput).toContain('diff --git a/file.ts');
    expect(parsed.instruction).toContain('explain these changes');
    expect(parsed.instruction).toContain('```');
  });

  it('pipe stdin with multi-line git log and positional prompt', () => {
    const log = 'abc1234 feat: add auth\\ndef5678 fix: race condition\\nghi9012 refactor: utils';
    const parsed = run(`printf '${log}' | npx tsx "${scriptPath}" "summarize recent changes"`);
    expect(parsed.instruction).toContain('summarize recent changes');
    expect(parsed.instruction).toContain('feat: add auth');
    expect(parsed.instruction).toContain('fix: race condition');
  });

  // ---- Edge cases ----

  it('handles single-word positional prompt', () => {
    const parsed = run(`npx tsx "${scriptPath}" "review"`);
    expect(parsed.prompt).toBe('review');
  });
});
