import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as atomicFiles from '../../src/utils/atomicFile.js';
import { SkillResourceMaterializer } from '../../src/skills/SkillResourceMaterializer.js';
import { createSkillRevisionManifest, computeSkillRevision } from '../../src/skills/SkillRevisionStore.js';
import type { SkillRevisionArchive } from '../../src/skills/SkillRevisionStore.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skill-resources-'));
  roots.push(directory);
  const root = path.join(directory, 'resources');
  const files = new Map<string, Uint8Array>([
    ['SKILL.md', Buffer.from('Run scripts/check.sh and read references/checks.md from this pinned package.')],
    ['scripts/check.sh', Buffer.from('#!/bin/sh\nprintf "Do not execute this fixture.\\n"\n')],
    ['references/checks.md', Buffer.from('Independent checks remain intact.')],
    ['assets/data.bin', new Uint8Array([0, 255, 128, 1, 0])],
    ['assets/empty.bin', new Uint8Array()],
  ]);
  const manifest = createSkillRevisionManifest(files);
  const archive: SkillRevisionArchive = { reference: { authority: 'personal:owner', packageId: 'verify', revision: computeSkillRevision(manifest) }, manifest, files };
  const partition = path.join(root, hash(archive.reference.authority), hash(archive.reference.packageId), archive.reference.revision.slice(7));
  return { root, archive, partition, materializer: new SkillResourceMaterializer(root) };
}

describe('pinned skill resource materializer', () => {
  it('materializes the complete package with exact binary bytes and owner-only script execution permissions', async () => {
    const { materializer, archive } = await fixture();
    const resourceRoot = await materializer.materialize(archive);
    for (const [resource, content] of archive.files) expect(new Uint8Array(await readFile(path.join(resourceRoot, resource)))).toEqual(new Uint8Array(content));
    expect((await stat(path.join(resourceRoot, 'scripts/check.sh'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(resourceRoot, 'SKILL.md'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(resourceRoot, 'assets/data.bin'))).mode & 0o777).toBe(0o600);
    expect((await stat(resourceRoot)).mode & 0o777).toBe(0o700);
    expect((await lstat(resourceRoot)).isSymbolicLink()).toBe(false);
    expect(await readdir(resourceRoot)).toEqual(['SKILL.md', 'assets', 'references', 'scripts']);
  });

  it('returns the same verified immutable root across reuse, concurrent writers, and new materializer instances', async () => {
    const { root, archive, partition } = await fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => new SkillResourceMaterializer(root).materialize(archive)));
    expect(new Set(results).size).toBe(1);
    expect(await new SkillResourceMaterializer(root).materialize(archive)).toBe(results[0]);
    expect((await readdir(partition)).filter(name => name.startsWith('.package-'))).toHaveLength(1);
    expect((await readdir(partition)).filter(name => name.endsWith('.lock'))).toEqual([]);
  });

  it('keeps the same bytes from separate authorities or package identities in distinct roots', async () => {
    const { materializer, archive } = await fixture();
    const first = await materializer.materialize(archive);
    const authority = await materializer.materialize({ ...archive, reference: { ...archive.reference, authority: 'team:owner' } });
    const otherPackage = await materializer.materialize({ ...archive, reference: { ...archive.reference, packageId: 'other' } });
    expect(new Set([first, authority, otherPackage]).size).toBe(3);
  });

  it('fails explicitly on changed package files and preserves user edits', async () => {
    const { materializer, archive } = await fixture();
    const resourceRoot = await materializer.materialize(archive);
    await writeFile(path.join(resourceRoot, 'scripts/check.sh'), '#!/bin/sh\nUSER_EDIT=1\n');
    await expect(materializer.materialize(archive)).rejects.toThrow(/corrupt|digest|bytes|manifest/i);
    expect(await readFile(path.join(resourceRoot, 'scripts/check.sh'), 'utf8')).toBe('#!/bin/sh\nUSER_EDIT=1\n');
  });

  it('rejects unexpected files, directories, and missing resources without deleting them', async () => {
    const { materializer, archive } = await fixture();
    const resourceRoot = await materializer.materialize(archive);
    const userFile = path.join(resourceRoot, 'user-authored.md');
    await writeFile(userFile, 'Keep this user file.');
    await expect(materializer.materialize(archive)).rejects.toThrow(/unexpected|manifest|corrupt/i);
    expect(await readFile(userFile, 'utf8')).toBe('Keep this user file.');
    await rm(userFile);
    await mkdir(path.join(resourceRoot, 'user-directory'));
    await expect(materializer.materialize(archive)).rejects.toThrow(/unexpected|manifest|corrupt/i);
    await rm(path.join(resourceRoot, 'user-directory'), { recursive: true });
    await rm(path.join(resourceRoot, 'assets/empty.bin'));
    await expect(materializer.materialize(archive)).rejects.toThrow(/missing|manifest|corrupt/i);
  });

  it.each(['../outside', '/outside', 'a/../../outside', 'a\\outside', 'a//b', 'C:/outside'])('rejects unsafe archived resource path %j before writing', async resource => {
    const { root, materializer, archive } = await fixture();
    const files = new Map(archive.files);
    files.set(resource, Buffer.from('unsafe'));
    await expect(materializer.materialize({ ...archive, files })).rejects.toThrow(/resource|path/i);
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates complete manifests, exact revisions, and bounded packages before allocating a physical root', async () => {
    const { root, materializer, archive } = await fixture();
    await expect(materializer.materialize({ ...archive, reference: { ...archive.reference, revision: `sha256:${'0'.repeat(64)}` } })).rejects.toThrow(/revision|manifest/i);
    await expect(materializer.materialize({ ...archive, manifest: archive.manifest.slice(1) })).rejects.toThrow(/manifest|SKILL/i);
    const files = new Map(archive.files);
    files.set('assets/too-big.bin', new Uint8Array(16_000_001));
    await expect(materializer.materialize({ ...archive, files })).rejects.toThrow(/budget|bytes/i);
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlinks at cache, identity, package-directory, and resource-file boundaries', async () => {
    const { root, partition, materializer, archive } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'skill-resources-outside-'));
    roots.push(outside);
    await symlink(outside, root, 'dir');
    await expect(materializer.materialize(archive)).rejects.toThrow(/link|escape|directory/i);
    await rm(root);
    await mkdir(root);
    await symlink(outside, path.join(root, hash(archive.reference.authority)), 'dir');
    await expect(materializer.materialize(archive)).rejects.toThrow(/link|escape|directory/i);
    await rm(path.join(root, hash(archive.reference.authority)));
    const resourceRoot = await materializer.materialize(archive);
    const script = path.join(resourceRoot, 'scripts/check.sh');
    const userFile = path.join(outside, 'user-script');
    await writeFile(userFile, 'Keep this user file.');
    await rm(script);
    await symlink(userFile, script);
    await expect(materializer.materialize(archive)).rejects.toThrow(/link|escape|resource/i);
    expect(await readFile(userFile, 'utf8')).toBe('Keep this user file.');
    await rm(resourceRoot, { recursive: true });
    await symlink(outside, resourceRoot, 'dir');
    await expect(materializer.materialize(archive)).rejects.toThrow(/link|escape|directory/i);
    expect((await readdir(partition)).some(name => name.endsWith('.lock'))).toBe(false);
  });

  it('cleans unpublished package directories on write failure and can retry cleanly', async () => {
    const { materializer, archive, partition } = await fixture();
    vi.spyOn(atomicFiles, 'atomicWriteJson').mockRejectedValueOnce(new Error('Simulated publication failure.'));
    await expect(materializer.materialize(archive)).rejects.toThrow('Simulated publication failure.');
    expect(await readdir(partition)).toEqual([]);
    expect(await materializer.materialize(archive)).toBeTruthy();
  });

  it('cleans partially written packages when a resource conflicts with a directory', async () => {
    const { materializer, archive, partition } = await fixture();
    const files = new Map(archive.files);
    files.set('scripts', Buffer.from('Conflicting file.'));
    const manifest = createSkillRevisionManifest(files);
    const candidate = { ...archive, files, manifest, reference: { ...archive.reference, revision: computeSkillRevision(manifest) } };
    const candidatePartition = path.join(path.dirname(partition), candidate.reference.revision.slice(7));
    await expect(materializer.materialize(candidate)).rejects.toThrow();
    expect(await readdir(candidatePartition)).toEqual([]);
  });

  it('does not follow a publication-file symlink or modify its user-authored target', async () => {
    const { root, materializer, archive, partition } = await fixture();
    await materializer.materialize(archive);
    const userFile = path.join(path.dirname(root), 'user-publication.json');
    await writeFile(userFile, 'Keep this user file.');
    await rm(path.join(partition, 'publication.json'));
    await symlink(userFile, path.join(partition, 'publication.json'));
    await expect(materializer.materialize(archive)).rejects.toThrow(/link|resource|publication/i);
    expect(await readFile(userFile, 'utf8')).toBe('Keep this user file.');
  });

  it('does not overwrite an intervening publication edit and removes only its unpublished package', async () => {
    const { materializer, archive, partition } = await fixture();
    const originalWrite = atomicFiles.atomicWriteJson;
    vi.spyOn(atomicFiles, 'atomicWriteJson').mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      await writeFile(path.join(partition, 'publication.json'), 'User-authored publication repair.');
    });
    await expect(materializer.materialize(archive)).rejects.toThrow(/publication|corrupt|invalid/i);
    expect(await readFile(path.join(partition, 'publication.json'), 'utf8')).toBe('User-authored publication repair.');
    expect(await readdir(partition)).toEqual(['publication.json']);
  });

  it('rejects a publication pointer that attempts to escape the revision partition', async () => {
    const { materializer, archive, partition } = await fixture();
    await materializer.materialize(archive);
    await writeFile(path.join(partition, 'publication.json'), JSON.stringify({ version: 1, directory: '../outside' }));
    await expect(materializer.materialize(archive)).rejects.toThrow(/publication|directory|path|escape/i);
  });

  it('validates an existing root without creating or repairing a deleted publication', async () => {
    const { materializer, archive, partition } = await fixture();
    const resourceRoot = await materializer.materialize(archive);
    await materializer.verify(archive, resourceRoot);
    await rm(path.join(partition, 'publication.json'));
    const before = await readdir(partition);
    await expect(materializer.verify(archive, resourceRoot)).rejects.toThrow(/missing|publication|root/i);
    expect(await readdir(partition)).toEqual(before);
  });
});
