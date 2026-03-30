/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as commandActions from '../../src/actions/command';
import { extractLlamaCppPort, looksLikeLlamaCppProcess, probeLlamaCppEnvironment } from '../../src/providers/llamaCppSetup';

describe('llamaCppSetup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects llama-server-like processes', () => {
    expect(looksLikeLlamaCppProcess('/usr/local/bin/llama-server --port 8080')).toBe(true);
    expect(looksLikeLlamaCppProcess('', 'llama-server.exe')).toBe(true);
    expect(looksLikeLlamaCppProcess('/usr/bin/python app.py')).toBe(false);
  });

  it('extracts ports from common llama-server flags', () => {
    expect(extractLlamaCppPort('llama-server --port 8080')).toBe(8080);
    expect(extractLlamaCppPort('llama-server --port=80')).toBe(80);
    expect(extractLlamaCppPort('llama-server -p 9090')).toBe(9090);
    expect(extractLlamaCppPort('llama-server')).toBeUndefined();
  });

  it('treats a PATH-discoverable llama-server as installed', async () => {
    const runCommandSpy = vi.spyOn(commandActions, 'runCommand')
      .mockResolvedValueOnce({ stdout: '/opt/homebrew/bin/llama-server\n', stderr: '', code: 0, signal: null })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0, signal: null });

    global.fetch = vi.fn().mockRejectedValue(new Error('not running'));

    const result = await probeLlamaCppEnvironment('/repo');

    expect(result.installed).toBe(true);
    expect(result.installPlan).toBeUndefined();
    expect(runCommandSpy).toHaveBeenCalledWith('which', ['llama-server'], '/repo', { timeout: 5000 });
  });
});
