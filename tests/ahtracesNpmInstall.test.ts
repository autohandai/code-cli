/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installAhTraces,
  parseAhTracesChecksum,
  resolveAhTracesArtifact,
} from '../scripts/install-ahtraces.mjs';
import { resolveAhTracesExecutable } from '../src/integrations/ahtraces/client.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryPackage(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'autohand-ahtraces-npm-'));
  roots.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'autohand-cli',
    version: '1.2.3',
  }));
  return root;
}

describe('npm ahtraces distribution', () => {
  it.each([
    ['darwin', 'arm64', 'ahtraces-macos-arm64', 'ahtraces'],
    ['darwin', 'x64', 'ahtraces-macos-x64', 'ahtraces'],
    ['linux', 'arm64', 'ahtraces-linux-arm64', 'ahtraces'],
    ['linux', 'x64', 'ahtraces-linux-x64', 'ahtraces'],
    ['win32', 'x64', 'ahtraces-windows-x64.exe', 'ahtraces.exe'],
  ] as const)('maps %s/%s to its release asset', (platform, architecture, assetName, binaryName) => {
    expect(resolveAhTracesArtifact(platform, architecture)).toEqual({ assetName, binaryName });
  });

  it('rejects unsupported npm platforms without guessing a binary', () => {
    expect(() => resolveAhTracesArtifact('linux', 'ia32')).toThrow(
      'ahtraces is not available for linux/ia32',
    );
  });

  it('accepts only the checksum for the exact release asset', () => {
    const digest = 'a'.repeat(64);

    expect(parseAhTracesChecksum(
      `${digest}  ahtraces-linux-x64\n`,
      'ahtraces-linux-x64',
    )).toBe(digest);
    expect(() => parseAhTracesChecksum(
      `${digest}  ahtraces-linux-arm64\n`,
      'ahtraces-linux-x64',
    )).toThrow('does not describe ahtraces-linux-x64');
    expect(() => parseAhTracesChecksum(
      `not-a-digest  ahtraces-linux-x64\n`,
      'ahtraces-linux-x64',
    )).toThrow('invalid ahtraces checksum');
  });

  it('downloads, verifies, and installs the matching companion atomically', async () => {
    const packageRoot = temporaryPackage();
    const payload = Buffer.from('native ahtraces fixture');
    const digest = createHash('sha256').update(payload).digest('hex');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('.sha256')) {
        return new Response(`${digest}  ahtraces-linux-x64\n`, { status: 200 });
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.byteLength) },
      });
    });

    await expect(installAhTraces({
      packageRoot,
      version: '1.2.3',
      platform: 'linux',
      architecture: 'x64',
      fetchImpl,
    })).resolves.toEqual({
      status: 'installed',
      path: path.join(packageRoot, 'vendor', 'ahtraces'),
      assetName: 'ahtraces-linux-x64',
    });

    const installed = path.join(packageRoot, 'vendor', 'ahtraces');
    expect(readFileSync(installed)).toEqual(payload);
    expect(statSync(installed).mode & 0o777).toBe(0o755);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      'https://github.com/autohandai/code-cli/releases/download/v1.2.3/ahtraces-linux-x64.sha256',
      'https://github.com/autohandai/code-cli/releases/download/v1.2.3/ahtraces-linux-x64',
    ]);
    expect(readdirSync(path.join(packageRoot, 'vendor')).some((entry) => entry.endsWith('.tmp')))
      .toBe(false);
  });

  it('does not install a companion whose bytes fail release checksum verification', async () => {
    const packageRoot = temporaryPackage();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => (
      String(input).endsWith('.sha256')
        ? new Response(`${'a'.repeat(64)}  ahtraces-linux-x64\n`, { status: 200 })
        : new Response('tampered binary', { status: 200 })
    ));

    await expect(installAhTraces({
      packageRoot,
      version: '1.2.3',
      platform: 'linux',
      architecture: 'x64',
      fetchImpl,
    })).rejects.toThrow('checksum verification failed');
    expect(existsSync(path.join(packageRoot, 'vendor', 'ahtraces'))).toBe(false);
  });

  it('resolves the npm-installed companion before falling back beside Node', () => {
    const packageRoot = temporaryPackage();
    const distDirectory = path.join(packageRoot, 'dist');
    const companion = path.join(packageRoot, 'vendor', 'ahtraces');
    mkdirSync(distDirectory);
    mkdirSync(path.dirname(companion));
    writeFileSync(companion, 'fixture');

    expect(resolveAhTracesExecutable(
      {},
      '/opt/node/bin/node',
      'linux',
      path.join(distDirectory, 'index.js'),
    )).toBe(companion);
  });

  it('follows an npm bin symlink back to the package companion', () => {
    const packageRoot = temporaryPackage();
    const distDirectory = path.join(packageRoot, 'dist');
    const binDirectory = path.join(packageRoot, 'npm-bin');
    const entrypoint = path.join(distDirectory, 'index.js');
    const companion = path.join(packageRoot, 'vendor', 'ahtraces');
    const launcher = path.join(binDirectory, 'autohand');
    mkdirSync(distDirectory);
    mkdirSync(binDirectory);
    mkdirSync(path.dirname(companion));
    writeFileSync(entrypoint, 'fixture');
    writeFileSync(companion, 'fixture');
    symlinkSync(entrypoint, launcher);

    expect(resolveAhTracesExecutable(
      {},
      '/opt/node/bin/node',
      'linux',
      launcher,
    )).toBe(realpathSync(companion));
  });

  it('prefers the package companion over an unrelated binary beside Node', () => {
    const packageRoot = temporaryPackage();
    const distDirectory = path.join(packageRoot, 'dist');
    const runtimeDirectory = path.join(packageRoot, 'node-runtime');
    const entrypoint = path.join(distDirectory, 'index.js');
    const companion = path.join(packageRoot, 'vendor', 'ahtraces');
    const staleSystemCompanion = path.join(runtimeDirectory, 'ahtraces');
    mkdirSync(distDirectory);
    mkdirSync(runtimeDirectory);
    mkdirSync(path.dirname(companion));
    writeFileSync(entrypoint, 'fixture');
    writeFileSync(companion, 'current package companion');
    writeFileSync(staleSystemCompanion, 'stale system companion');

    expect(resolveAhTracesExecutable(
      {},
      path.join(runtimeDirectory, 'node'),
      'linux',
      entrypoint,
    )).toBe(realpathSync(companion));
  });

  it('ships an npm launcher and installer while publishing raw companion checksums', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      bin: Record<string, string>;
      files: string[];
      scripts: Record<string, string>;
    };
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const tracesGuide = readFileSync('docs/traces.md', 'utf8');
    const features = readFileSync('docs/features.md', 'utf8');

    expect(manifest.bin.ahtraces).toBe('scripts/ahtraces-launcher.mjs');
    expect(manifest.files).toContain('scripts/ahtraces-launcher.mjs');
    expect(manifest.files).toContain('scripts/install-ahtraces.mjs');
    expect(manifest.scripts.postinstall).toContain('node scripts/install-ahtraces.mjs');
    expect(releaseWorkflow).toContain('sha256sum "$traces_binary" > "${traces_binary}.sha256"');
    expect(tracesGuide).toContain('npm install -g autohand-cli');
    expect(tracesGuide).toContain('AUTOHAND_SKIP_AHTRACES_INSTALL=1');
    expect(features).toContain('npm postinstall');
  });

  it('forwards npm launcher arguments to an explicitly selected companion', () => {
    const output = execFileSync(process.execPath, [
      'scripts/ahtraces-launcher.mjs',
      '-e',
      'process.stdout.write("launcher-ok")',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOHAND_AHTRACES_EXECUTABLE: process.execPath,
      },
    });

    expect(output).toBe('launcher-ok');
  });
});
