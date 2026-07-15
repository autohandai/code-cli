/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXTENSION_MANIFEST_FILE,
  parseExtensionManifest,
  readExtensionPackage,
  resolveExtensionContributionPath,
} from '../../src/extensions/manifest.js';
import { validateExtensionPackage } from '../../src/extensions/ExtensionRegistry.js';

function validManifest() {
  return {
    schemaVersion: 1,
    extensionApi: 1,
    id: 'autohand.code-health',
    name: 'Code Health',
    version: '1.0.0',
    description: 'Find maintainability risks.',
    license: 'Apache-2.0',
    repository: 'https://github.com/autohandai/code-extensions',
    contributes: {
      tools: ['tools/find-todos.json'],
      agents: ['agents/code-health-reviewer.md'],
    },
  };
}

describe('extension manifest', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function createPackage(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-extension-manifest-'));
    tempRoots.push(root);
    await fs.ensureDir(path.join(root, 'tools'));
    await fs.ensureDir(path.join(root, 'agents'));
    await fs.writeJson(path.join(root, EXTENSION_MANIFEST_FILE), validManifest());
    await fs.writeJson(path.join(root, 'tools', 'find-todos.json'), {
      name: 'find_todos',
      description: 'Find TODO comments',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: 'git grep -n TODO -- {{path}}',
      source: 'user',
    });
    await fs.writeFile(
      path.join(root, 'agents', 'code-health-reviewer.md'),
      '# Code Health Reviewer\n\nReview maintainability risks.\n',
    );
    return root;
  }

  it('parses the exact versioned v1 contract', () => {
    expect(parseExtensionManifest(validManifest())).toEqual(validManifest());
  });

  it.each([
    ['unknown manifest keys', { ...validManifest(), typo: true }],
    ['unknown contribution keys', {
      ...validManifest(),
      contributes: { ...validManifest().contributes, commandz: ['x'] },
    }],
    ['an unqualified id', { ...validManifest(), id: 'code_health' }],
    ['a non-semver version', { ...validManifest(), version: 'v1' }],
    ['an unsupported schema version', { ...validManifest(), schemaVersion: 2 }],
    ['an unsupported API version', { ...validManifest(), extensionApi: 2 }],
    ['an empty package', { ...validManifest(), contributes: {} }],
    ['duplicate tool paths', {
      ...validManifest(),
      contributes: { tools: ['tools/find-todos.json', 'tools/find-todos.json'] },
    }],
  ])('rejects %s', (_label, manifest) => {
    expect(() => parseExtensionManifest(manifest)).toThrow(/invalid extension manifest/i);
  });

  it.each([
    '../outside.json',
    '/tmp/outside.json',
    'C:\\outside.json',
    'tools\\windows-separator.json',
    'tools/../outside.json',
    'tools//double.json',
    '',
  ])('rejects unsafe contribution path %j', (declaredPath) => {
    expect(() => parseExtensionManifest({
      ...validManifest(),
      contributes: { tools: [declaredPath] },
    })).toThrow(/invalid extension manifest/i);
  });

  it('loads a complete package without executing its contributions', async () => {
    const root = await createPackage();

    const extensionPackage = await readExtensionPackage(root);
    const realRoot = await fs.realpath(root);

    expect(extensionPackage.manifest.id).toBe('autohand.code-health');
    expect(extensionPackage.root).toBe(realRoot);
    expect(extensionPackage.contributionFiles).toEqual({
      tools: [path.join(realRoot, 'tools', 'find-todos.json')],
      agents: [path.join(realRoot, 'agents', 'code-health-reviewer.md')],
    });
  });

  it('rejects a contribution symlink that escapes the package root', async () => {
    const root = await createPackage();
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.json`);
    tempRoots.push(outside);
    await fs.writeJson(outside, { name: 'outside' });
    await fs.remove(path.join(root, 'tools', 'find-todos.json'));
    await fs.symlink(outside, path.join(root, 'tools', 'find-todos.json'));

    await expect(readExtensionPackage(root)).rejects.toThrow(/outside the extension root|symlink/i);
  });

  it('rejects a symlinked manifest instead of reading package metadata outside the root', async () => {
    const root = await createPackage();
    const manifestPath = path.join(root, EXTENSION_MANIFEST_FILE);
    const outside = path.join(path.dirname(root), `${path.basename(root)}-manifest.json`);
    tempRoots.push(outside);
    await fs.move(manifestPath, outside);
    await fs.symlink(outside, manifestPath);

    await expect(readExtensionPackage(root)).rejects.toThrow(/manifest.*regular file|symlink/i);
  });

  it('rejects missing contribution files with the declared relative path', async () => {
    const root = await createPackage();
    await fs.remove(path.join(root, 'tools', 'find-todos.json'));

    await expect(readExtensionPackage(root)).rejects.toThrow(/tools\/find-todos\.json/);
  });

  it('rejects duplicate JSON object keys instead of accepting the last value', async () => {
    const root = await createPackage();
    const manifestPath = path.join(root, EXTENSION_MANIFEST_FILE);
    await fs.writeFile(
      manifestPath,
      JSON.stringify(validManifest()).replace(
        '"name":"Code Health"',
        '"name":"Code Health","name":"Shadowed"',
      ),
    );

    await expect(readExtensionPackage(root)).rejects.toThrow(/duplicate json key.*name/i);
  });

  it('rejects oversized manifests and contribution files before parsing', async () => {
    const root = await createPackage();
    await fs.writeFile(path.join(root, EXTENSION_MANIFEST_FILE), ' '.repeat(65 * 1024));
    await expect(readExtensionPackage(root)).rejects.toThrow(/65536-byte limit/i);

    await fs.writeJson(path.join(root, EXTENSION_MANIFEST_FILE), validManifest());
    await fs.writeFile(path.join(root, 'tools', 'find-todos.json'), ' '.repeat(257 * 1024));
    await expect(readExtensionPackage(root)).rejects.toThrow(/262144-byte limit/i);
  });

  it('rejects invalid UTF-8 in JSON and Markdown contributions', async () => {
    const jsonRoot = await createPackage();
    await fs.writeFile(path.join(jsonRoot, 'tools', 'find-todos.json'), Buffer.from([0xc3, 0x28]));
    await expect(validateExtensionPackage(jsonRoot)).rejects.toThrow(/valid UTF-8/i);

    const markdownRoot = await createPackage();
    await fs.writeFile(
      path.join(markdownRoot, 'agents', 'code-health-reviewer.md'),
      Buffer.from([0xc3, 0x28]),
    );
    await expect(validateExtensionPackage(markdownRoot)).rejects.toThrow(/valid UTF-8/i);
  });

  it('resolves a contained regular contribution file', async () => {
    const root = await createPackage();
    const realRoot = await fs.realpath(root);

    await expect(resolveExtensionContributionPath(root, 'tools/find-todos.json'))
      .resolves.toBe(path.join(realRoot, 'tools', 'find-todos.json'));
  });
});
