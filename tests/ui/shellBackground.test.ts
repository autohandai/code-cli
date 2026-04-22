/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { executeStreamingShellCommand } from '../../src/ui/shellCommand.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

describe('executeStreamingShellCommand background mode', () => {
  const testDir = join(tmpdir(), 'autohand-shell-bg-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return immediately with backgroundPid when background: true', async () => {
    const result = await executeStreamingShellCommand(
      'sleep 5',
      testDir,
      { background: true }
    );

    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
    expect(result.backgroundPid).toBeGreaterThan(0);
    expect(result.output).toBe('');
  });

  it('should run command in background and allow parent to continue', async () => {
    const start = Date.now();
    
    const result = await executeStreamingShellCommand(
      'sleep 2 && echo "done" > /tmp/autohand-bg-test.txt',
      testDir,
      { background: true }
    );

    const elapsed = Date.now() - start;
    
    // Should return almost immediately (< 100ms)
    expect(elapsed).toBeLessThan(100);
    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
  });

  it('should handle invalid commands gracefully in background mode', async () => {
    const result = await executeStreamingShellCommand(
      'nonexistentcommand12345',
      testDir,
      { background: true }
    );

    // Background mode spawns the shell, so it succeeds even if command fails
    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
  });
});