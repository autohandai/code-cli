/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runRestrictedProfile(
  args: string[],
  request: Record<string, unknown>,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [
      '--preload',
      'tests/fixtures/rpcPanicFetch.ts',
      'src/index.ts',
      ...args,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTOHAND_DISABLE_AUTO_REPORT: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Restricted RPC process did not exit after stdin closed.'));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

describe('Blueprint restricted RPC processes', () => {
  it('starts and inspects with no fetch, provider construction, config write, or extra stdout', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'autohand-answer-process-'));
    const configPath = path.join(directory, 'missing', 'config.json');
    try {
      const result = await runRestrictedProfile([
        '--mode', 'rpc',
        '--answer-only',
        '--restricted',
        '--client-context', 'blueprint',
        '--config', configPath,
      ], {
        jsonrpc: '2.0',
        method: 'autohand.runtimeInspect',
        id: 1,
      });

      expect(result.code).toBe(0);
      expect(result.stderr).not.toContain('UNEXPECTED_RPC_FETCH');
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          answerContractVersion: 1,
          clientContext: 'blueprint',
          answerOnly: true,
          toolsEnabled: false,
          hooksEnabled: false,
          mcpEnabled: false,
          memoryEnabled: false,
          sessionPersistenceEnabled: false,
        },
      });
      await expect(access(configPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts setup-only without network and rejects unrelated methods terminally', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'autohand-setup-process-'));
    const configPath = path.join(directory, 'missing', 'config.json');
    try {
      const result = await runRestrictedProfile([
        '--mode', 'rpc',
        '--setup-only',
        '--restricted',
        '--client-context', 'blueprint',
        '--config', configPath,
      ], {
        jsonrpc: '2.0',
        method: 'autohand.runtimeInspect',
        id: 2,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain('UNEXPECTED_RPC_FETCH');
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        jsonrpc: '2.0',
        id: 2,
        error: {
          code: -32014,
          data: { kind: 'profile_violation', retryable: false },
        },
      });
      await expect(access(configPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
