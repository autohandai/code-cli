/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommunitySkillsCache } from '../../src/skills/CommunitySkillsCache.js';
import {
  validateCommunityRelativePath,
  validateCommunitySkillIdentifier,
} from '../../src/skills/communitySkillPaths.js';

describe('community skill path policy', () => {
  it.each([
    '',
    '../outside',
    '/absolute',
    'C:\\outside',
    '\\\\server\\share',
    'with space',
    'UPPERCASE',
    'con',
    'nul',
    'com1',
    'a'.repeat(65),
    'nul\0byte',
  ])('rejects unsafe filesystem identifiers without sanitizing them: %j', (value) => {
    expect(() => validateCommunitySkillIdentifier(value)).toThrow(/invalid/i);
  });

  it.each([
    '',
    '.',
    '..',
    '../outside',
    '/absolute',
    'C:\\outside',
    '\\\\server\\share',
    'nested\\mixed.md',
    'nested//empty.md',
    'nested/./dot.md',
    'nested/../outside.md',
    'nested/file.md?raw=1',
    'nested/file.md#fragment',
    'nested/control\u0001.md',
    'nested/file.md:alternate-stream',
    'nested/CON',
    'nested/con.txt',
    'nested/trailing.',
    'nested/trailing ',
    'nested/file<name>.md',
    'nested/file|name.md',
    'nested/file*name.md',
  ])('rejects unsafe relative POSIX paths: %j', (value) => {
    expect(() => validateCommunityRelativePath(value)).toThrow(/invalid/i);
  });

  it('preserves valid nested POSIX paths unchanged', () => {
    expect(validateCommunityRelativePath('templates/example.md')).toBe('templates/example.md');
    expect(validateCommunitySkillIdentifier('safe-skill')).toBe('safe-skill');
  });
});

describe('CommunitySkillsCache containment', () => {
  let tempRoot: string;
  let cacheDir: string;
  let outsideDir: string;
  let cache: CommunitySkillsCache;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'community-cache-containment-'));
    cacheDir = path.join(tempRoot, 'cache');
    outsideDir = path.join(tempRoot, 'outside');
    await fs.ensureDir(outsideDir);
    cache = new CommunitySkillsCache({ cacheDir, maxSkillsCache: 2 });
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  it.each(['../outside', '/absolute', 'C:\\outside', '', 'UPPERCASE']) (
    'rejects unsafe IDs before body or directory cache access: %j',
    async (skillId) => {
      await expect(cache.getSkillBody(skillId)).rejects.toThrow(/invalid/i);
      await expect(cache.setSkillBody(skillId, 'body')).rejects.toThrow(/invalid/i);
      await expect(cache.getSkillDirectory(skillId)).rejects.toThrow(/invalid/i);
      await expect(
        cache.setSkillDirectory(skillId, new Map([['SKILL.md', 'body']]))
      ).rejects.toThrow(/invalid/i);
    }
  );

  it('validates every file key before removing an existing cached directory', async () => {
    const existingPath = path.join(cacheDir, 'skills', 'safe-skill', 'SKILL.md');
    await fs.outputFile(existingPath, 'original');
    const outsideSentinel = path.join(outsideDir, 'sentinel.txt');
    await fs.writeFile(outsideSentinel, 'outside');

    await expect(cache.setSkillDirectory('safe-skill', new Map([
      ['SKILL.md', 'replacement'],
      ['../../outside/sentinel.txt', 'overwritten'],
    ]))).rejects.toThrow(/invalid/i);

    expect(await fs.readFile(existingPath, 'utf8')).toBe('original');
    expect(await fs.readFile(outsideSentinel, 'utf8')).toBe('outside');
  });

  it('round-trips valid nested assets', async () => {
    const files = new Map([
      ['SKILL.md', '# Nested'],
      ['templates/example.md', 'example'],
      ['scripts/check.ts', 'export {};'],
    ]);

    await cache.setSkillDirectory('nested-skill', files);

    expect(await cache.getSkillDirectory('nested-skill')).toEqual(files);
  });

  it('treats a poisoned cached directory as a miss', async () => {
    await fs.outputFile(path.join(cacheDir, 'skills', 'safe-skill', 'SKILL.md'), '# Safe');
    await fs.writeFile(path.join(cacheDir, 'skills', 'safe-skill', 'bad?raw=1'), 'poison');

    expect(await cache.getSkillDirectory('safe-skill')).toBeNull();
  });

  it('does not read or replace a cache child symlink that escapes the cache root', async () => {
    const outsideSkillDir = path.join(outsideDir, 'safe-skill');
    const outsideSentinel = path.join(outsideSkillDir, 'SKILL.md');
    await fs.outputFile(outsideSentinel, 'outside');
    await fs.ensureDir(path.join(cacheDir, 'skills'));
    await fs.symlink(outsideSkillDir, path.join(cacheDir, 'skills', 'safe-skill'), 'dir');

    expect(await cache.getSkillDirectory('safe-skill')).toBeNull();
    await expect(cache.setSkillDirectory(
      'safe-skill',
      new Map([['SKILL.md', 'replacement']])
    )).rejects.toThrow(/symlink|outside|contain/i);
    expect(await fs.readFile(outsideSentinel, 'utf8')).toBe('outside');
  });

  it('revalidates poisoned registry data on every cache read', async () => {
    await fs.outputJson(path.join(cacheDir, 'registry.json'), {
      fetchedAt: Date.now(),
      registry: {
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
        categories: [],
        skills: [{
          id: '../outside',
          name: 'safe-skill',
          description: 'Poisoned',
          category: 'testing',
          directory: 'safe-skill',
          files: ['SKILL.md'],
        }],
      },
    });

    expect(await cache.getRegistry()).toBeNull();
    expect(await cache.getRegistryIgnoreTTL()).toBeNull();
  });

  it('validates registry metadata before creating cache files', async () => {
    await expect(cache.setRegistry({
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      categories: [],
      skills: [{
        id: '../outside',
        name: 'Unsafe skill',
        description: 'Unsafe registry entry.',
        category: 'testing',
        directory: 'safe-skill',
        files: ['SKILL.md'],
      }],
    })).rejects.toThrow(/invalid/i);

    expect(await fs.pathExists(cacheDir)).toBe(false);
  });

  it('does not follow an eviction symlink outside the skills cache', async () => {
    const outsideSentinel = path.join(outsideDir, 'sentinel.txt');
    await fs.writeFile(outsideSentinel, 'outside');
    const skillsDir = path.join(cacheDir, 'skills');
    await fs.ensureDir(skillsDir);
    await fs.symlink(outsideDir, path.join(skillsDir, 'linked-skill'), 'dir');

    cache = new CommunitySkillsCache({ cacheDir, maxSkillsCache: 1 });
    await fs.outputFile(path.join(skillsDir, 'old-skill', 'SKILL.md'), '# Old');
    await fs.symlink(outsideDir, path.join(skillsDir, 'old-skill', 'outside-link'), 'dir');

    await cache.setSkillDirectory('safe-skill', new Map([['SKILL.md', '# Safe']]));

    expect(await fs.readFile(outsideSentinel, 'utf8')).toBe('outside');
  });
});
