import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveZitBin } from '../src/utils/sessionZit.js';
import * as zitInstaller from '../scripts/install-zit.mjs';
import { prepareZitPackageInstallScenario } from '../src/testing/scenarios/zitPackageInstallScenario.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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
  it.skipIf(!['darwin', 'linux'].includes(process.platform)).each(['npm', 'bun'] as const)('prepares a clean package for an untrusted %s install without a local vendor cache', async manager => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'autohand-zit-clean-package-')));
    roots.push(root);
    const repository = path.join(root, 'source');
    const scenario = path.join(root, 'scenario');
    mkdirSync(path.join(repository, 'dist'), { recursive: true });
    mkdirSync(path.join(repository, 'node_modules'));
    writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'autohand-cli', version: '0.0.0', type: 'module',
      files: ['dist', 'vendor/zit'], bin: { autohand: 'dist/index.js' },
      scripts: { postinstall: 'node -e "process.exit(91)"' },
    }));
    writeFileSync(path.join(repository, 'dist/index.js'), '#!/usr/bin/env node\nconsole.log("package fixture");\n', { mode: 0o755 });
    const prepare = vi.spyOn(zitInstaller, 'installZit').mockImplementation(async options => {
      if (!options?.packageRoot) throw new Error('Package preparation needs an isolated package root');
      const directory = path.join(options.packageRoot, 'vendor', 'zit', process.platform + '-' + process.arch);
      mkdirSync(directory, { recursive: true });
      for (const binary of ['zit', 'git-zit']) {
        writeFileSync(path.join(directory, binary), '#!/bin/sh\necho zit-fixture\n', { mode: 0o755 });
      }
      writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ version: '0.1.2' }));
      return { status: 'installed', path: path.join(directory, 'zit') };
    });

    const installed = await prepareZitPackageInstallScenario(repository, scenario, manager);

    const bundled = path.join(installed.packageRoot, 'vendor', 'zit', process.platform + '-' + process.arch);
    expect(JSON.parse(readFileSync(path.join(bundled, 'manifest.json'), 'utf8'))).toEqual({ version: '0.1.2' });
    expect(readFileSync(path.join(bundled, 'zit'), 'utf8')).toContain('zit-fixture');
    expect(prepare).toHaveBeenCalledOnce();
    expect(readFileSync(path.join(installed.packageRoot, 'package.json'), 'utf8')).toContain('process.exit(91)');
  });

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
