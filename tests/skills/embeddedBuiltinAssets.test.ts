/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectBuiltinAssets, renderBuiltinAssetsModule } from '../../scripts/embed-builtin-assets.js';
import { BUILTIN_ASSETS, BUILTIN_ASSETS_DIGEST } from '../../src/generated/builtinAssets.js';
import {
  materializeEmbeddedBuiltinAssets,
  resolveEmbeddedBuiltinAssetDirectory,
} from '../../src/skills/embeddedBuiltinAssets.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fse.remove(root)));
});

async function tempRoot(): Promise<string> {
  const root = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-embedded-builtin-'));
  tempRoots.push(root);
  return root;
}

describe('generated built-in assets module', () => {
  it('matches the files under src/skills/builtin and src/agents/builtin', async () => {
    const assets = await collectBuiltinAssets();
    const generatedPath = path.resolve('src/generated/builtinAssets.ts');

    expect(
      await fse.readFile(generatedPath, 'utf8'),
      'src/generated/builtinAssets.ts is stale; run `bun run embed:builtin`',
    ).toBe(renderBuiltinAssetsModule(assets));
  });

  it('embeds every built-in skill, including extension-builder with its references', () => {
    const keys = Object.keys(BUILTIN_ASSETS);
    expect(keys).toContain('skills/builtin/extension-builder/SKILL.md');
    expect(keys.some((key) => key.startsWith('skills/builtin/extension-builder/references/'))).toBe(true);
    expect(keys.some((key) => key.startsWith('agents/builtin/'))).toBe(true);
    expect(BUILTIN_ASSETS_DIGEST).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('materializeEmbeddedBuiltinAssets', () => {
  it('writes the embedded files under a digest-keyed directory and reuses it', async () => {
    const root = await tempRoot();
    const assets = {
      'skills/builtin/demo/SKILL.md': '---\nname: demo\n---\nDemo body',
      'agents/builtin/demo.md': 'agent body',
    };

    const first = await materializeEmbeddedBuiltinAssets({ root, assets, digest: 'abc123' });
    expect(first).toBe(path.join(root, 'abc123'));
    expect(await fse.readFile(path.join(first, 'skills', 'builtin', 'demo', 'SKILL.md'), 'utf8')).toBe(assets['skills/builtin/demo/SKILL.md']);

    await fse.writeFile(path.join(first, 'skills', 'builtin', 'demo', 'SKILL.md'), 'edited');
    const second = await materializeEmbeddedBuiltinAssets({ root, assets, digest: 'abc123' });
    expect(second).toBe(first);
    expect(await fse.readFile(path.join(first, 'skills', 'builtin', 'demo', 'SKILL.md'), 'utf8')).toBe('edited');
    expect(await fse.readdir(root)).toEqual(['abc123']);
  });

  it('gives a new digest its own directory without touching the old one', async () => {
    const root = await tempRoot();
    const assets = { 'skills/builtin/demo/SKILL.md': 'v1' };
    await materializeEmbeddedBuiltinAssets({ root, assets, digest: 'v1' });
    const next = await materializeEmbeddedBuiltinAssets({ root, assets: { 'skills/builtin/demo/SKILL.md': 'v2' }, digest: 'v2' });

    expect(await fse.readFile(path.join(next, 'skills', 'builtin', 'demo', 'SKILL.md'), 'utf8')).toBe('v2');
    expect((await fse.readdir(root)).sort()).toEqual(['v1', 'v2']);
  });

  it('resolves the skills and agents directories of the real embedded bundle', async () => {
    const root = await tempRoot();
    const skillsDir = await resolveEmbeddedBuiltinAssetDirectory('skills', { root });
    const agentsDir = await resolveEmbeddedBuiltinAssetDirectory('agents', { root });

    expect(skillsDir).toBe(path.join(root, BUILTIN_ASSETS_DIGEST, 'skills', 'builtin'));
    expect(await fse.pathExists(path.join(skillsDir, 'extension-builder', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(agentsDir, 'researcher.md'))).toBe(true);
  });
});
