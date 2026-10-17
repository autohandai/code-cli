import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundleZit, installZit, resolveZitArtifact } from '../scripts/install-zit.mjs';

const roots: string[] = [];
const targets = [
  ['darwin', 'arm64', 'aarch64-apple-darwin'],
  ['darwin', 'x64', 'x86_64-apple-darwin'],
  ['linux', 'arm64', 'aarch64-unknown-linux-gnu'],
  ['linux', 'x64', 'x86_64-unknown-linux-gnu'],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'autohand-zit-bundle-'));
  roots.push(root);
  return root;
}

function releaseFixture(target = 'aarch64-apple-darwin', unsafe = false) {
  const root = temporaryRoot();
  const name = `zit-v0.1.2-${target}`;
  mkdirSync(path.join(root, name));
  writeFileSync(path.join(root, name, 'git-zit'), '#!/bin/sh\necho git-zit-fixture\n');
  chmodSync(path.join(root, name, 'git-zit'), 0o755);
  if (unsafe) symlinkSync(path.join(root, 'outside'), path.join(root, name, 'zit'));
  else {
    writeFileSync(path.join(root, name, 'zit'), '#!/bin/sh\necho zit-fixture\n');
    chmodSync(path.join(root, name, 'zit'), 0o755);
  }
  const archive = path.join(root, 'archive.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, name]);
  const bytes = readFileSync(archive);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith('.sha256')
    ? new Response(`${digest}  ${name}.tar.gz\n`)
    : new Response(bytes));
  return { bytes, digest, name, fetchImpl };
}

function options(packageRoot: string, fetchImpl: typeof fetch) {
  return { packageRoot, platform: 'darwin', architecture: 'arm64', environment: {}, fetchImpl };
}

describe('verified Zit package preparation', () => {
  it.each(targets)('selects the official %s/%s archive', (platform, architecture, target) => {
    expect(resolveZitArtifact(platform, architecture)).toEqual({ name: `zit-v0.1.2-${target}`, directory: `${platform}-${architecture}` });
  });

  it('does not pretend an unsupported platform has a native binary', async () => {
    const fetchImpl = vi.fn();
    expect(resolveZitArtifact('win32', 'x64')).toBeNull();
    expect(resolveZitArtifact('linux', 'ia32')).toBeNull();
    await expect(installZit({ packageRoot: temporaryRoot(), platform: 'win32', architecture: 'x64', fetchImpl })).resolves.toEqual({ status: 'unsupported' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads and verifies both binaries and reuses a verified bundle without network requests', async () => {
    const packageRoot = temporaryRoot();
    const release = releaseFixture();
    const input = options(packageRoot, release.fetchImpl);
    const destination = path.join(packageRoot, 'vendor', 'zit', 'darwin-arm64');
    await expect(installZit(input)).resolves.toMatchObject({ status: 'installed', path: path.join(destination, 'zit') });
    for (const binary of ['zit', 'git-zit']) {
      expect(readFileSync(path.join(destination, binary), 'utf8')).toContain(`${binary}-fixture`);
      expect(statSync(path.join(destination, binary)).mode & 0o777).toBe(0o755);
    }
    expect(release.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://github.com/autohandai/getzit/releases/download/v0.1.2/${release.name}.tar.gz.sha256`,
      `https://github.com/autohandai/getzit/releases/download/v0.1.2/${release.name}.tar.gz`,
    ]);
    release.fetchImpl.mockClear();
    await expect(installZit(input)).resolves.toMatchObject({ status: 'existing' });
    expect(release.fetchImpl).not.toHaveBeenCalled();
    expect(readdirSync(path.dirname(destination))).toEqual(['darwin-arm64']);
  });

  it('rejects corrupted downloads while preserving existing binaries', async () => {
    const packageRoot = temporaryRoot();
    const destination = path.join(packageRoot, 'vendor', 'zit', 'darwin-arm64');
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, 'zit'), 'existing-zit');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith('.sha256')
      ? new Response(`${'0'.repeat(64)}  zit-v0.1.2-aarch64-apple-darwin.tar.gz\n`)
      : new Response('corrupted'));
    await expect(installZit(options(packageRoot, fetchImpl))).rejects.toThrow('checksum verification failed');
    expect(readFileSync(path.join(destination, 'zit'), 'utf8')).toBe('existing-zit');
    expect(readdirSync(path.dirname(destination))).toEqual(['darwin-arm64']);
  });

  it('rejects a checksum document describing a different archive', async () => {
    const packageRoot = temporaryRoot();
    const fetchImpl = vi.fn(async () => new Response(`${'a'.repeat(64)}  other-platform.tar.gz\n`));
    await expect(installZit(options(packageRoot, fetchImpl))).rejects.toThrow('does not describe');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('replaces an altered cached binary with a newly verified release', async () => {
    const packageRoot = temporaryRoot();
    const { fetchImpl } = releaseFixture();
    const input = options(packageRoot, fetchImpl);
    await installZit(input);
    const binary = path.join(packageRoot, 'vendor', 'zit', 'darwin-arm64', 'zit');
    writeFileSync(binary, 'modified');
    await expect(installZit(input)).resolves.toMatchObject({ status: 'installed' });
    expect(readFileSync(binary, 'utf8')).toContain('zit-fixture');
    expect(readdirSync(path.dirname(path.dirname(binary)))).toEqual(['darwin-arm64']);
  });

  it.skipIf(process.platform === 'win32')('repairs a cached binary that its owner cannot execute', async () => {
    const packageRoot = temporaryRoot();
    const { fetchImpl } = releaseFixture();
    const input = options(packageRoot, fetchImpl);
    await installZit(input);
    const binary = path.join(packageRoot, 'vendor', 'zit', 'darwin-arm64', 'zit');
    chmodSync(binary, 0o641);
    await expect(installZit(input)).resolves.toMatchObject({ status: 'installed' });
    expect(statSync(binary).mode & 0o777).toBe(0o755);
  });

  it.skipIf(process.platform === 'win32')('rejects symlink binaries and cleans extracted temporary files', async () => {
    const packageRoot = temporaryRoot();
    const { fetchImpl } = releaseFixture('aarch64-apple-darwin', true);
    await expect(installZit(options(packageRoot, fetchImpl))).rejects.toThrow('regular file');
    expect(existsSync(path.join(packageRoot, 'vendor', 'zit', 'darwin-arm64', 'zit'))).toBe(false);
    expect(readdirSync(path.join(packageRoot, 'vendor', 'zit'))).toEqual([]);
  });

  it('cancels an unsuccessful HTTP response body before throwing', async () => {
    const response = new Response('unavailable', { status: 503 });
    const cancel = vi.spyOn(response.body!, 'cancel');
    await expect(installZit(options(temporaryRoot(), vi.fn(async () => response)))).rejects.toThrow('HTTP 503');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels downloads that declare an excessive size', async () => {
    const response = new Response('oversized', { headers: { 'content-length': '999999999' } });
    const cancel = vi.spyOn(response.body!, 'cancel');
    await expect(installZit(options(temporaryRoot(), vi.fn(async () => response)))).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds streamed archives even without a content-length header and releases their reader', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)); },
      cancel,
    });
    const response = new Response(stream);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith('.sha256')
      ? new Response(`${'a'.repeat(64)}  zit-v0.1.2-aarch64-apple-darwin.tar.gz\n`)
      : response);
    await expect(installZit(options(temporaryRoot(), fetchImpl))).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('honors the installation opt-out and skips ordinary source checkout installs', async () => {
    const packageRoot = temporaryRoot();
    const fetchImpl = vi.fn();
    await expect(installZit({ ...options(packageRoot, fetchImpl), environment: { AUTOHAND_SKIP_ZIT_INSTALL: '1' } })).resolves.toEqual({ status: 'skipped' });
    writeFileSync(path.join(packageRoot, '.git'), 'worktree git pointer');
    await expect(installZit(options(packageRoot, fetchImpl))).resolves.toEqual({ status: 'skipped-development' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prepares every supported platform for Bun installs even when installer opt-out is set on the publisher', async () => {
    const packageRoot = temporaryRoot();
    writeFileSync(path.join(packageRoot, '.git'), 'source checkout');
    const releases = new Map(targets.map(([, , target]) => {
      const release = releaseFixture(target);
      return [release.name, release];
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const release = [...releases.values()].find(candidate => url.includes(`${candidate.name}.tar.gz`));
      if (!release) throw new Error(`Unexpected URL: ${url}`);
      return url.endsWith('.sha256')
        ? new Response(`${release.digest}  ${release.name}.tar.gz\n`)
        : new Response(release.bytes);
    });
    await bundleZit({ packageRoot, fetchImpl, environment: { AUTOHAND_SKIP_ZIT_INSTALL: '1' } });
    for (const [platform, architecture] of targets) {
      expect(existsSync(path.join(packageRoot, 'vendor', 'zit', `${platform}-${architecture}`, 'zit'))).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });
});
