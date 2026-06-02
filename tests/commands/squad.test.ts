/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { metadata, parseSquadCommand, runSquadCommand } from '../../src/commands/squad.js';

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 403,
    json: async () => payload,
    arrayBuffer: async () => Buffer.from(JSON.stringify(payload)),
  } as Response;
}

function bytesResponse(bytes: Buffer): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => bytes,
  } as Response;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeInstalledRuntime(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  for (const binary of ['squad', 'autohand-squad-daemon', 'autohand-squad-analytics', 'autohand-squad-tray', 'autohand-squad-ui']) {
    await writeFile(path.join(binDir, binary), '#!/bin/sh\n');
    await chmod(path.join(binDir, binary), 0o755);
  }
}

function spawnResult(stdout: string, code = 0) {
  return vi.fn((_command: string, _args: string[]) => {
    const child = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();
    child.stdout = out as ChildProcess['stdout'];
    child.stderr = err as ChildProcess['stderr'];
    queueMicrotask(() => {
      out.end(stdout);
      err.end('');
      child.emit('close', code);
    });
    return child;
  });
}

describe('/squad command', () => {
  let tempRoot: string;
  let squadHome: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'autohand-squad-'));
    squadHome = path.join(tempRoot, 'state');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('declares slash command metadata', () => {
    expect(metadata.command).toBe('/squad');
    expect(metadata.implemented).toBe(true);
  });

  it('keeps /squad as an open alias and supports management subcommands', () => {
    expect(parseSquadCommand([])).toEqual({ action: 'open', passthroughArgs: [] });
    expect(parseSquadCommand(['--no-open'])).toEqual({ action: 'start', passthroughArgs: ['--no-open'] });
    expect(parseSquadCommand(['status'])).toEqual({ action: 'status', passthroughArgs: [] });
    expect(parseSquadCommand(['restart', '--port', '19999'])).toEqual({
      action: 'restart',
      passthroughArgs: ['--port', '19999'],
    });
  });

  it('does not install when the user is not logged in', async () => {
    const fetchImpl = vi.fn();
    const result = await runSquadCommand(
      { workspaceRoot: '/repo', config: {} as any },
      [],
      { env: { AUTOHAND_SQUAD_HOME: squadHome }, fetchImpl: fetchImpl as unknown as typeof fetch, homeDir: tempRoot },
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain('Sign in to Autohand');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not install when plan or feature flag gating fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, activePlan: false, squadDaemonEnabled: true }));

    const result = await runSquadCommand(
      { workspaceRoot: '/repo', config: { auth: { token: 'token' } } as any },
      [],
      { env: { AUTOHAND_SQUAD_HOME: squadHome }, fetchImpl: fetchImpl as unknown as typeof fetch, homeDir: tempRoot },
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain('Squad is not active');
  });

  it('downloads verified runtime binaries before delegating start/open', async () => {
    const squadBytes = Buffer.from('#!/bin/sh\necho squad\n');
    const daemonBytes = Buffer.from('#!/bin/sh\necho daemon\n');
    const analyticsBytes = Buffer.from('#!/bin/sh\necho analytics\n');
    const trayBytes = Buffer.from('#!/bin/sh\necho tray\n');
    const uiBytes = Buffer.from('#!/bin/sh\necho ui\n');
    const manifest = {
      latestAllowedVersion: '1.2.3',
      channel: 'stable',
      artifacts: [
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'squad',
          url: 'https://downloads.test/squad',
          sha256: sha256(squadBytes),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-daemon',
          url: 'https://downloads.test/daemon',
          sha256: sha256(daemonBytes),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-analytics',
          url: 'https://downloads.test/analytics',
          sha256: sha256(analyticsBytes),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-tray',
          url: 'https://downloads.test/tray',
          sha256: sha256(trayBytes),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-ui',
          url: 'https://downloads.test/ui',
          sha256: sha256(uiBytes),
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        activePlan: true,
        squadDaemonEnabled: true,
        latestAllowedVersion: '1.2.3',
        manifestUrl: 'https://api.test/manifest',
        accountEmail: 'ops@example.com',
        planState: 'enterprise',
      }))
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(bytesResponse(squadBytes))
      .mockResolvedValueOnce(bytesResponse(daemonBytes))
      .mockResolvedValueOnce(bytesResponse(analyticsBytes))
      .mockResolvedValueOnce(bytesResponse(trayBytes))
      .mockResolvedValueOnce(bytesResponse(uiBytes));
    const spawnProcess = spawnResult('opened\n');

    const result = await runSquadCommand(
      { workspaceRoot: '/Users/test/repo one', config: { auth: { token: 'token' } } as any },
      [],
      {
        env: { AUTOHAND_SQUAD_HOME: squadHome },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        homeDir: tempRoot,
        now: () => new Date('2026-05-25T00:00:00Z'),
        spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      },
    );

    expect(result).toEqual({ code: 0, output: 'opened' });
    expect(spawnProcess).toHaveBeenCalledWith(
      path.join(squadHome, 'bin', 'squad'),
      expect.arrayContaining([
        'open',
        '--open-url',
        'http://127.0.0.1:19821/conversations/new?workspace=%2FUsers%2Ftest%2Frepo+one',
        '--api-base-url',
        'https://api.autohand.ai',
        '--account-email',
        'ops@example.com',
        '--plan-state',
        'enterprise',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          AUTOHAND_SQUAD_API_AUTH_TOKEN: 'token',
          AUTOHAND_SQUAD_ACCOUNT_EMAIL: 'ops@example.com',
          AUTOHAND_SQUAD_PLAN_STATE: 'enterprise',
        }),
      }),
    );
    await expect(readFile(path.join(squadHome, 'bin', 'squad'), 'utf8')).resolves.toBe(squadBytes.toString());
    const daemonMode = (await stat(path.join(squadHome, 'bin', 'autohand-squad-daemon'))).mode;
    expect(daemonMode & 0o111).not.toBe(0);
    await expect(readFile(path.join(squadHome, 'bin', 'autohand-squad-analytics'), 'utf8')).resolves.toBe(analyticsBytes.toString());
    await expect(readFile(path.join(squadHome, 'bin', 'autohand-squad-tray'), 'utf8')).resolves.toBe(trayBytes.toString());
    await expect(readFile(path.join(squadHome, 'bin', 'autohand-squad-ui'), 'utf8')).resolves.toBe(uiBytes.toString());
    const installRecord = JSON.parse(await readFile(path.join(squadHome, 'install.json'), 'utf8')) as { version: string };
    expect(installRecord.version).toBe('1.2.3');
    const runtimeConfig = JSON.parse(await readFile(path.join(squadHome, 'config.json'), 'utf8')) as { accountEmail: string; planState: string };
    expect(runtimeConfig).toMatchObject({ accountEmail: 'ops@example.com', planState: 'enterprise' });
  });

  it('fails install on checksum mismatch before writing binaries', async () => {
    const squadBytes = Buffer.from('#!/bin/sh\necho squad\n');
    const manifest = {
      latestAllowedVersion: '1.2.3',
      channel: 'stable',
      artifacts: [
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'squad',
          url: 'https://downloads.test/squad',
          sha256: '0'.repeat(64),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-daemon',
          url: 'https://downloads.test/daemon',
          sha256: sha256(Buffer.from('daemon')),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-analytics',
          url: 'https://downloads.test/analytics',
          sha256: sha256(Buffer.from('analytics')),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-tray',
          url: 'https://downloads.test/tray',
          sha256: sha256(Buffer.from('tray')),
        },
        {
          os: process.platform,
          arch: process.arch,
          binaryName: 'autohand-squad-ui',
          url: 'https://downloads.test/ui',
          sha256: sha256(Buffer.from('ui')),
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        activePlan: true,
        squadDaemonEnabled: true,
        latestAllowedVersion: '1.2.3',
        manifestUrl: 'https://api.test/manifest',
      }))
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(bytesResponse(squadBytes));

    const result = await runSquadCommand(
      { workspaceRoot: '/repo', config: { auth: { token: 'token' } } as any },
      [],
      {
        env: { AUTOHAND_SQUAD_HOME: squadHome },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        homeDir: tempRoot,
        spawnProcess: spawnResult('should not run\n') as unknown as typeof import('node:child_process').spawn,
      },
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain('Checksum mismatch');
    await expect(readFile(path.join(squadHome, 'bin', 'squad'), 'utf8')).rejects.toThrow();
  });

  it('reuses a latest installed runtime for status without entitlement checks', async () => {
    const binDir = path.join(squadHome, 'bin');
    await writeInstalledRuntime(binDir);
    const fetchImpl = vi.fn();
    const spawnProcess = spawnResult('{"success":true}\n');

    const result = await runSquadCommand(
      { workspaceRoot: '/repo', config: {} as any },
      ['status'],
      {
        env: { AUTOHAND_SQUAD_HOME: squadHome },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        homeDir: tempRoot,
        spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      },
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain('"success":true');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(spawnProcess).toHaveBeenCalledWith(
      path.join(squadHome, 'bin', 'squad'),
      expect.arrayContaining(['status', '--api-base-url', 'https://api.autohand.ai', '--update-channel', 'stable']),
      expect.any(Object),
    );
  });

  it('maps /squad --no-open to squad start without leaking the alias-only flag', async () => {
    const binDir = path.join(squadHome, 'bin');
    await writeInstalledRuntime(binDir);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        activePlan: true,
        squadDaemonEnabled: true,
      }));
    const spawnProcess = spawnResult('started\n');

    const result = await runSquadCommand(
      { workspaceRoot: '/repo', config: { auth: { token: 'token' } } as any },
      ['--no-open', '--port', '19999'],
      {
        env: { AUTOHAND_SQUAD_HOME: squadHome },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        homeDir: tempRoot,
        spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      },
    );

    expect(result.code).toBe(0);
    expect(spawnProcess).toHaveBeenCalledWith(
      path.join(squadHome, 'bin', 'squad'),
      expect.arrayContaining(['start', '--port', '19999', '--open-url', 'http://127.0.0.1:19999/conversations/new?workspace=%2Frepo']),
      expect.any(Object),
    );
  });
});
