/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openSquadDesktop } from '../../src/commands/squadDesktop.js';

const BASE = 'https://releases.test';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function releaseFetch(files: Record<string, Buffer | string>) {
  return vi.fn(async (url: string | URL) => {
    const name = String(url).slice(BASE.length + 1);
    const body = files[name];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    const bytes = Buffer.from(body);
    return {
      ok: true,
      status: 200,
      text: async () => bytes.toString(),
      arrayBuffer: async () => bytes,
    } as unknown as Response;
  });
}

const signedIn = { auth: { token: 'token', user: { id: 'u', email: 'dev@example.com', name: 'Dev' } } } as any;

describe('openSquadDesktop', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'autohand-squad-desktop-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('launches an installed app without downloading and names the shared CLI account', async () => {
    const appImage = path.join(home, '.local', 'bin', 'autohand-squad.AppImage');
    await mkdir(path.dirname(appImage), { recursive: true });
    await writeFile(appImage, '#!/bin/sh\n');
    const fetchImpl = vi.fn();
    const launch = vi.fn();

    const result = await openSquadDesktop(signedIn, {
      platform: 'linux', arch: 'x64', homeDir: home, env: {}, fetchImpl: fetchImpl as unknown as typeof fetch, launch,
    });

    expect(result.code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith(appImage, []);
    expect(result.output).toContain('dev@example.com');
  });

  it('downloads, verifies and installs the latest release when Squad is missing', async () => {
    const appImageBytes = Buffer.from('appimage-bytes');
    const fileName = 'autohand-squad-0.1.8-linux-x64.AppImage';
    const fetchImpl = releaseFetch({
      'checksums-desktop-linux-x64.txt': `${sha256(Buffer.from('deb'))}  autohand-squad-0.1.8-linux-x64.deb\n${sha256(appImageBytes)}  ${fileName}\n`,
      [fileName]: appImageBytes,
    });
    const launch = vi.fn();
    const progress: string[] = [];

    const result = await openSquadDesktop(signedIn, {
      platform: 'linux', arch: 'x64', homeDir: home, env: { AUTOHAND_SQUAD_RELEASE_BASE_URL: BASE },
      fetchImpl: fetchImpl as unknown as typeof fetch, launch, onProgress: (line) => progress.push(line),
    });

    const appImage = path.join(home, '.local', 'bin', 'autohand-squad.AppImage');
    expect(result.code).toBe(0);
    expect(await readFile(appImage, 'utf8')).toBe('appimage-bytes');
    expect((await stat(appImage)).mode & 0o111).not.toBe(0);
    expect(launch).toHaveBeenCalledWith(appImage, []);
    expect(progress).toContain('Downloading Autohand Squad 0.1.8...');
    expect(result.output).toContain('Installed Autohand Squad 0.1.8');
  });

  it('refuses an installer whose checksum does not match', async () => {
    const fileName = 'autohand-squad-0.1.8-linux-x64.AppImage';
    const fetchImpl = releaseFetch({
      'checksums-desktop-linux-x64.txt': `${sha256(Buffer.from('expected'))}  ${fileName}\n`,
      [fileName]: Buffer.from('tampered'),
    });
    const launch = vi.fn();

    const result = await openSquadDesktop(signedIn, {
      platform: 'linux', arch: 'x64', homeDir: home, env: { AUTOHAND_SQUAD_RELEASE_BASE_URL: BASE },
      fetchImpl: fetchImpl as unknown as typeof fetch, launch,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('Checksum mismatch');
    expect(existsSync(path.join(home, '.local', 'bin', 'autohand-squad.AppImage'))).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });

  it('copies the app out of the macOS disk image, detaches it and opens the app', async () => {
    const dmgBytes = Buffer.from('dmg-bytes');
    const fileName = 'autohand-squad-0.1.8-macos-arm64.dmg';
    const fetchImpl = releaseFetch({
      'checksums-desktop-darwin-arm64.txt': `${sha256(dmgBytes)}  ${fileName}\n`,
      [fileName]: dmgBytes,
    });
    const applicationsDir = path.join(home, 'Applications-system');
    await mkdir(applicationsDir);
    const calls: string[][] = [];
    const run = vi.fn(async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (command === 'hdiutil' && args[0] === 'attach') {
        const mountPoint = args[args.indexOf('-mountpoint') + 1];
        await mkdir(path.join(mountPoint, 'Autohand Squad.app'), { recursive: true });
      }
      if (command === 'ditto') await mkdir(args[1], { recursive: true });
      return 0;
    });

    const result = await openSquadDesktop(undefined, {
      platform: 'darwin', arch: 'arm64', homeDir: home, applicationsDir,
      env: { AUTOHAND_SQUAD_RELEASE_BASE_URL: BASE }, fetchImpl: fetchImpl as unknown as typeof fetch, run,
    });

    const appPath = path.join(applicationsDir, 'Autohand Squad.app');
    expect(result.code).toBe(0);
    expect(calls.map(([command, first]) => `${command} ${first}`)).toEqual([
      'hdiutil attach', `ditto ${calls[1][1]}`, 'hdiutil detach', 'open -a',
    ]);
    expect(calls[1][2]).toBe(appPath);
    expect(calls[3]).toEqual(['open', '-a', appPath]);
    expect(result.output).toContain('autohand login');
  });

  it('points to the releases page on platforms without a desktop build', async () => {
    const fetchImpl = vi.fn();
    const result = await openSquadDesktop(signedIn, {
      platform: 'linux', arch: 'arm64', homeDir: home, env: {}, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('github.com/autohandai/squad/releases');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
