/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tester } from '../../src/commands/tester.js';

describe('/tester', () => {
  let workspaceRoot: string;
  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tester-command-'));
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "console.log(\'real test output\')"' },
    }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('turns user language into verifiable acceptance criteria and evidence requirements', async () => {
    const result = await tester({ workspaceRoot, isNonInteractive: true }, ['checkout should be easy']);
    expect(result).toContain('checkout should be easy');
    expect(result).toContain('requirements-translator');
    expect(result).toContain('tester');
    expect(result).toContain('Playwright');
    expect(result).toContain('animated WebP');
    expect(result).toContain('not-run');
    expect(result).toContain('actually opened and inspected');
  });

  it('executes an explicitly selected installed project script and links its real evidence', async () => {
    const queueInstruction = vi.fn();
    const result = await tester({ workspaceRoot, queueInstruction }, ['run', 'test']);
    expect(result).toContain('Project script: passed');
    expect(result).toContain('Exit code: 0');
    expect(result).toContain('report.md');
    expect(result).toContain('Visual inspection: not-run');
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('queues verification with trusted metadata preventing automatic dependency installation', async () => {
    const queueInstruction = vi.fn();
    await tester({ workspaceRoot, queueInstruction }, ['verify checkout']);
    expect(queueInstruction).toHaveBeenCalledWith(expect.any(String), undefined, { environmentBootstrap: 'skip' });
  });

  it('reports missing Playwright as not-run rather than fabricating visual confirmation', async () => {
    const result = await tester({ workspaceRoot }, ['capture', 'http://127.0.0.1:4321']);
    expect(result).toContain('Browser capture: not-run');
    expect(result).toContain('Visual inspection: not-run');
    expect(result).toContain('report.md');
  });

  it('rejects scenario files outside the workspace without executing a capture', async () => {
    const result = await tester({ workspaceRoot }, ['capture', 'http://127.0.0.1:4321', '../scenario.json']);
    expect(result).toContain('inside the workspace');
  });

  it('uses the runtime cancellation boundary and leaves no SIGINT listener behind', async () => {
    const listeners = process.listenerCount('SIGINT');
    const result = await tester({
      workspaceRoot,
      runCancellableOperation: operation => operation(AbortSignal.abort()),
    }, ['run', 'test']);
    expect(result).toContain('cancelled');
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('shows bounded syntax without enqueueing work', async () => {
    const queueInstruction = vi.fn();
    expect(await tester({ workspaceRoot, queueInstruction }, ['help'])).toContain('/tester capture');
    expect(await tester({ workspaceRoot, queueInstruction }, ['run'])).toContain('Usage:');
    expect(queueInstruction).not.toHaveBeenCalled();
  });
});
