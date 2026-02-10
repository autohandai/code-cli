/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

/**
 * Integration tests for pipe mode stdin wiring.
 *
 * These tests spawn a real Node.js subprocess with piped stdin to verify
 * that detectStdinType + readPipedStdin + buildPipePrompt work end-to-end
 * when connected through an actual OS pipe.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
let tempDir: string;
let scriptPath: string;

function buildTestScript(): string {
  const srcRoot = path.join(ROOT, 'src');
  return `
import { detectStdinType, readPipedStdin } from '${srcRoot}/utils/stdinDetector.js';
import { buildPipePrompt } from '${srcRoot}/modes/pipeMode.js';

async function main() {
  const stdinType = detectStdinType();
  if (stdinType !== 'pipe') {
    process.stdout.write(JSON.stringify({ error: 'not-pipe', stdinType }));
    process.exit(1);
  }

  const pipedInput = await readPipedStdin();
  const instruction = buildPipePrompt('explain this', pipedInput);
  process.stdout.write(JSON.stringify({ stdinType, pipedInput, instruction }));
}

main().catch(err => {
  process.stderr.write(String(err));
  process.exit(1);
});
`;
}

describe('Pipe mode integration', () => {
  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-pipe-test-'));
    scriptPath = path.join(tempDir, 'pipe-test.ts');
    await fs.writeFile(scriptPath, buildTestScript());
  });

  afterAll(async () => {
    await fs.remove(tempDir);
  });

  it('reads piped stdin and combines with prompt via real OS pipe', () => {
    const diffContent = 'diff --git a/file.ts\\n-old\\n+new';

    const result = execSync(
      `printf '${diffContent}' | npx tsx "${scriptPath}"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 15_000 },
    );

    const parsed = JSON.parse(result.trim());
    expect(parsed.stdinType).toBe('pipe');
    expect(parsed.pipedInput).toContain('diff --git a/file.ts');
    expect(parsed.pipedInput).toContain('-old');
    expect(parsed.pipedInput).toContain('+new');
    expect(parsed.instruction).toContain('explain this');
    expect(parsed.instruction).toContain('```');
  });

  it('handles empty piped input gracefully', () => {
    const result = execSync(
      `echo '' | npx tsx "${scriptPath}"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 15_000 },
    );

    const parsed = JSON.parse(result.trim());
    expect(parsed.stdinType).toBe('pipe');
    expect(parsed.instruction).toBe('explain this');
  });

  it('handles multi-line piped input from a real command', () => {
    const multiLine = 'commit abc123\\nauthor: test\\ndate: today\\n\\nfix: resolved the issue';

    const result = execSync(
      `printf '${multiLine}' | npx tsx "${scriptPath}"`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 15_000 },
    );

    const parsed = JSON.parse(result.trim());
    expect(parsed.stdinType).toBe('pipe');
    expect(parsed.pipedInput).toContain('commit abc123');
    expect(parsed.pipedInput).toContain('fix: resolved the issue');
    expect(parsed.instruction).toContain('explain this');
    expect(parsed.instruction).toContain('commit abc123');
  });
});
