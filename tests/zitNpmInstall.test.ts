import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveZitBin } from '../src/utils/sessionZit.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function packageFixture(platform = 'darwin', architecture = 'arm64') {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'autohand-zit-npm-')));
  roots.push(root);
  const entryPath = path.join(root, 'dist', 'index.js');
  const binary = path.join(root, 'vendor', 'zit', `${platform}-${architecture}`, 'zit');
  mkdirSync(path.dirname(entryPath), { recursive: true });
  mkdirSync(path.dirname(binary), { recursive: true });
  writeFileSync(entryPath, '');
  writeFileSync(binary, '#!/bin/sh\necho zit-fixture\n');
  chmodSync(binary, 0o755);
  return { root, entryPath, binary };
}

describe('Zit npm and Bun distribution', () => {
  it('prepares verified Zit binaries before packing and includes them in the package', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      files: string[];
      scripts: Record<string, string>;
    };
    expect(manifest.files).toContain('vendor/zit');
    expect(manifest.files).toContain('scripts/install-zit.mjs');
    expect(manifest.scripts.prepack).toBe('node scripts/install-zit.mjs --all');
    expect(manifest.scripts.postinstall).toContain('node scripts/install-zit.mjs');
  });

  it.each([
    ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'],
  ] as const)('finds the bundled %s/%s executable without PATH or lifecycle scripts', (platform, architecture) => {
    const { entryPath, binary } = packageFixture(platform, architecture);
    expect(resolveZitBin({ env: {}, platform, architecture, entryPath })).toBe(binary);
  });

  it('honors an explicit ZIT_BIN before the bundled executable', () => {
    const { entryPath } = packageFixture();
    expect(resolveZitBin({
      env: { ZIT_BIN: ' /custom/zit ' }, platform: 'darwin', architecture: 'arm64', entryPath,
    })).toBe('/custom/zit');
  });

  it('preserves an existing executable on PATH', () => {
    const { root, entryPath } = packageFixture();
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'zit'), '#!/bin/sh\n');
    chmodSync(path.join(bin, 'zit'), 0o755);
    expect(resolveZitBin({ env: { PATH: bin }, platform: 'darwin', architecture: 'arm64', entryPath })).toBe('zit');
  });

  it.skipIf(process.platform === 'win32')('follows a global npm bin symlink to the packaged executable', () => {
    const { root, entryPath, binary } = packageFixture();
    const launcher = path.join(root, 'autohand');
    symlinkSync(entryPath, launcher);
    expect(resolveZitBin({ env: {}, platform: 'darwin', architecture: 'arm64', entryPath: launcher })).toBe(binary);
  });

  it.skipIf(process.platform === 'win32')('rejects a bundled file that is not executable', () => {
    const { entryPath, binary, root } = packageFixture();
    chmodSync(binary, 0o644);
    expect(resolveZitBin({
      env: {}, platform: 'darwin', architecture: 'arm64', entryPath, moduleDirectory: path.join(root, 'dist'),
    })).toBe('zit');
  });
});
