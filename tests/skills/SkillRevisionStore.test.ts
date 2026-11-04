import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as atomicFiles from '../../src/utils/atomicFile.js';
import { SkillRevisionStore, computeSkillRevision, createSkillRevisionManifest } from '../../src/skills/SkillRevisionStore.js';
import type { SkillReference, SkillResourceDigest } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function hash(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'skill-revision-'));
  roots.push(directory);
  const root = path.join(directory, 'archives');
  const files = new Map<string, Uint8Array>([
    ['SKILL.md', Buffer.from('---\nname: verify\ndescription: Verify work\n---\nKeep all checks intact.')],
    ['scripts/check.bin', new Uint8Array([0, 255, 1, 128, 10])],
    ['references/checks.md', Buffer.from('Use independent checks.')],
  ]);
  const manifest = [...files].map(([resource, content]) => ({ path: resource, sha256: hash(content), bytes: content.byteLength }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const reference = { authority: 'personal:owner', packageId: 'verify', revision: `sha256:${hash(JSON.stringify(manifest))}` };
  return { root, files, manifest, reference, store: new SkillRevisionStore(root) };
}

function archivePath(root: string, reference: SkillReference): string {
  return path.join(root, hash(reference.authority), hash(reference.packageId), `${reference.revision!.slice(7)}.json`);
}

describe('immutable skill revision archive', () => {
  it('retains the complete portable package including binary resources across store instances', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    const published = await store.publish({ reference, manifest, files });
    expect(published.reference).toEqual(reference);
    const restored = await new SkillRevisionStore(root).read(reference);
    expect(restored?.manifest).toEqual(manifest);
    expect([...restored!.files.keys()]).toEqual(manifest.map(resource => resource.path));
    for (const [resource, content] of files) expect(restored?.files.get(resource)).toEqual(new Uint8Array(content));
    restored!.files.get('scripts/check.bin')![0] = 43;
    files.get('scripts/check.bin')![0] = 42;
    expect((await store.read(reference))?.files.get('scripts/check.bin')?.[0]).toBe(0);
  });

  it('returns only an exact absent revision as missing and never substitutes a current package', async () => {
    const { store, reference, manifest, files } = await fixture();
    expect(await store.read(reference)).toBeNull();
    await store.publish({ reference, manifest, files });
    expect(await store.read({ ...reference, revision: `sha256:${'a'.repeat(64)}` })).toBeNull();
    await expect(store.read({ ...reference, revision: undefined })).rejects.toThrow(/exact|revision/i);
    await expect(store.read({ ...reference, revision: '../../escape' })).rejects.toThrow(/revision/i);
  });

  it('partitions identical bytes by authority and package identity without overwriting either archive', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    const otherAuthority = { ...reference, authority: 'team:owner' };
    const otherPackage = { ...reference, packageId: 'second-verify' };
    await store.publish({ reference, manifest, files });
    await store.publish({ reference: otherAuthority, manifest, files });
    await store.publish({ reference: otherPackage, manifest, files });
    expect((await store.read(otherAuthority))?.reference).toEqual(otherAuthority);
    expect((await store.read(otherPackage))?.reference).toEqual(otherPackage);
    expect(archivePath(root, reference)).not.toBe(archivePath(root, otherAuthority));
    expect(archivePath(root, reference)).not.toBe(archivePath(root, otherPackage));
  });

  it('publishes idempotently across concurrent writers and leaves no staging or lock artifacts', async () => {
    const { root, reference, manifest, files } = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => new SkillRevisionStore(root).publish({ reference, manifest, files })));
    expect(results.every(result => result.reference.revision === reference.revision)).toBe(true);
    expect(await readdir(path.dirname(archivePath(root, reference)))).toEqual([path.basename(archivePath(root, reference))]);
  });

  it('uses deterministic lexical path order independently of locale collation and caller object key order', () => {
    const files = new Map<string, Uint8Array>([['z.md', Buffer.from('z')], ['SKILL.md', Buffer.from('skill')], ['Z.md', Buffer.from('Z')]]);
    const manifest = createSkillRevisionManifest(files);
    expect(manifest.map(resource => resource.path)).toEqual(['SKILL.md', 'Z.md', 'z.md']);
    const reversedKeys = manifest.map(resource => ({ bytes: resource.bytes, sha256: resource.sha256, path: resource.path })).reverse();
    expect(computeSkillRevision(reversedKeys)).toBe(`sha256:${hash(JSON.stringify(manifest))}`);
  });

  it('preserves a requested resource pin without making that resource a different package archive', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    const selected = { ...reference, resource: 'scripts/check.bin' };
    await store.publish({ reference: selected, manifest, files });
    expect((await store.read(selected))?.reference).toEqual(selected);
    expect((await store.read(reference))?.reference).toEqual(reference);
    expect(await readdir(path.dirname(archivePath(root, reference)))).toHaveLength(1);
    await expect(store.read({ ...reference, resource: 'missing.md' })).rejects.toThrow(/resource/i);
  });

  it.each(['../outside', '/outside', 'references/../../outside', 'references\\outside', 'a//b', 'a/./b', 'C:/outside', 'a\u0000b'])('rejects unsafe resource path %j before writing', async unsafe => {
    const { root, store, reference, files, manifest } = await fixture();
    const invalidFiles = new Map(files);
    invalidFiles.set(unsafe, Buffer.from('bad'));
    const invalidManifest = [...manifest, { path: unsafe, sha256: hash('bad'), bytes: 3 }];
    await expect(store.publish({ reference, files: invalidFiles, manifest: invalidManifest })).rejects.toThrow(/path|resource/i);
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal identity segments and malformed identity fields before touching the archive', async () => {
    const { store, reference, manifest, files } = await fixture();
    for (const invalid of [{ authority: '../outside' }, { packageId: '../outside' }, { authority: '' }, { packageId: 'a\u0000b' }]) {
      await expect(store.publish({ reference: { ...reference, ...invalid }, manifest, files })).rejects.toThrow(/identity|authority|package/i);
    }
  });

  it('validates revision, digests, byte counts, duplicates, missing instructions, and complete file sets before writing', async () => {
    const { store, reference, files, manifest } = await fixture();
    const wrongDigest = manifest.map(resource => resource.path === 'SKILL.md' ? { ...resource, sha256: 'f'.repeat(64) } : resource);
    const wrongBytes = manifest.map(resource => ({ ...resource, bytes: resource.bytes + 1 }));
    const missingFiles = new Map(files);
    missingFiles.delete('scripts/check.bin');
    const extraFiles = new Map(files);
    extraFiles.set('extra.md', Buffer.from('unexpected'));
    const withoutInstructions = manifest.filter(resource => resource.path !== 'SKILL.md');
    const cases: Array<{ reference: typeof reference; manifest: SkillResourceDigest[]; files: ReadonlyMap<string, Uint8Array> }> = [
      { reference: { ...reference, revision: `sha256:${'0'.repeat(64)}` }, manifest, files },
      { reference, manifest: wrongDigest, files },
      { reference, manifest: wrongBytes, files },
      { reference, manifest: [...manifest, manifest[0]], files },
      { reference, manifest, files: missingFiles },
      { reference, manifest, files: extraFiles },
      { reference, manifest: withoutInstructions, files: new Map([...files].filter(([resource]) => resource !== 'SKILL.md')) },
    ];
    for (const candidate of cases) await expect(store.publish(candidate)).rejects.toThrow(/revision|digest|bytes|manifest|file|SKILL/i);
  });

  it('rejects excessive file counts and bytes without allocating an archive', async () => {
    const { root, store, reference } = await fixture();
    const manyFiles = new Map<string, Uint8Array>(Array.from({ length: 2_049 }, (_, index) => [index ? `references/${index}.md` : 'SKILL.md', new Uint8Array()]));
    expect(() => createSkillRevisionManifest(manyFiles)).toThrow(/budget|limit|count/i);
    const large = new Map([['SKILL.md', new Uint8Array(16_000_001)]]);
    expect(() => createSkillRevisionManifest(large)).toThrow(/budget|limit|bytes/i);
    await expect(store.publish({ reference, manifest: [], files: manyFiles })).rejects.toThrow();
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite an intervening user edit or accept damaged existing archives as idempotent success', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    await store.publish({ reference, manifest, files });
    const filename = archivePath(root, reference);
    const userEdit = 'User-authored archive repair in progress.';
    await writeFile(filename, userEdit);
    await expect(store.read(reference)).rejects.toThrow(/corrupt|invalid|archive/i);
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/corrupt|invalid|archive/i);
    expect(await readFile(filename, 'utf8')).toBe(userEdit);
    expect(await readdir(path.dirname(filename))).toEqual([path.basename(filename)]);
  });

  it('uses atomic no-replace publication when another writer inserts a file during staging', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    const filename = archivePath(root, reference);
    const originalWrite = atomicFiles.atomicWriteJson;
    vi.spyOn(atomicFiles, 'atomicWriteJson').mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      await writeFile(filename, 'Intervening user edit.');
    });
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/corrupt|invalid|archive/i);
    expect(await readFile(filename, 'utf8')).toBe('Intervening user edit.');
    expect(await readdir(path.dirname(filename))).toEqual([path.basename(filename)]);
  });

  it('cleans its staging directory and lock after a failed write and supports a clean retry', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    vi.spyOn(atomicFiles, 'atomicWriteJson').mockRejectedValueOnce(new Error('Simulated disk failure.'));
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow('Simulated disk failure.');
    expect(await readdir(path.dirname(archivePath(root, reference)))).toEqual([]);
    expect(await store.read(reference)).toBeNull();
    expect((await store.publish({ reference, manifest, files })).reference).toEqual(reference);
  });

  it('does not follow a replaced package directory into user files while cleaning a failed stage', async () => {
    const { store, reference, manifest, files } = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'skill-revision-diverted-'));
    roots.push(outside);
    let userFile = '';
    const originalWrite = atomicFiles.atomicWriteJson;
    vi.spyOn(atomicFiles, 'atomicWriteJson').mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      const staged = path.dirname(args[0]);
      const parent = path.dirname(staged);
      await rename(parent, `${parent}.moved`);
      const divertedStage = path.join(outside, path.basename(staged));
      await mkdir(divertedStage);
      userFile = path.join(divertedStage, 'user-authored.md');
      await writeFile(userFile, 'Keep this user file.');
      await symlink(outside, parent, 'dir');
    });
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/link|escape|directory/i);
    expect(await readFile(userFile, 'utf8')).toBe('Keep this user file.');
  });

  it('checks identity, manifest, and binary contents again on every read', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    await store.publish({ reference, manifest, files });
    const filename = archivePath(root, reference);
    const original = await readFile(filename, 'utf8');
    const changed = JSON.parse(original) as { reference: SkillReference };
    changed.reference.authority = 'forged';
    await writeFile(filename, JSON.stringify(changed));
    await expect(store.read(reference)).rejects.toThrow(/identity|reference|archive/i);
    await writeFile(filename, original.replace(Buffer.from(files.get('scripts/check.bin')!).toString('base64'), '//////8='));
    await expect(store.read(reference)).rejects.toThrow(/digest|bytes|archive/i);
  });

  it('revalidates persisted revision, resource paths, byte limits, counts, and canonical binary encoding', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    await store.publish({ reference, manifest, files });
    const filename = archivePath(root, reference);
    const original = JSON.parse(await readFile(filename, 'utf8')) as {
      reference: SkillReference;
      manifest: SkillResourceDigest[];
      files: Array<{ path: string; base64: string }>;
    };
    const mutations: Array<(value: typeof original) => void> = [
      value => { value.reference.revision = `sha256:${'0'.repeat(64)}`; },
      value => { value.manifest[0].path = '../outside'; },
      value => { value.manifest[0].bytes = 16_000_001; },
      value => { value.files.pop(); },
      value => { value.files[0].base64 = '!'.repeat(value.files[0].base64.length); },
      value => { value.files[0].path = value.files[1].path; },
      value => { value.files = Array.from({ length: 2_049 }, () => value.files[0]); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original);
      mutate(changed);
      await writeFile(filename, JSON.stringify(changed));
      await expect(store.read(reference)).rejects.toThrow(/revision|identity|path|bytes|budget|file|encoding|archive/i);
    }
    await truncate(filename, 100_000_000);
    await expect(store.read(reference)).rejects.toThrow(/budget|bytes/i);
  });

  it('retains empty binary resources as part of the complete revision', async () => {
    const { store, reference, files } = await fixture();
    files.set('references/empty.bin', new Uint8Array());
    const manifest = createSkillRevisionManifest(files);
    const pinned = { ...reference, revision: computeSkillRevision(manifest) };
    await store.publish({ reference: pinned, manifest, files });
    expect((await store.read(pinned))?.files.get('references/empty.bin')).toEqual(new Uint8Array());
  });

  it('rejects symbolic links at the store, package, and archive boundaries', async () => {
    const { root, store, reference, manifest, files } = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'skill-revision-outside-'));
    roots.push(outside);
    await symlink(outside, root, 'dir');
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/link|escape|directory/i);
    await expect(store.read(reference)).rejects.toThrow(/link|escape|directory/i);
    await rm(root);
    await mkdir(root);
    await symlink(outside, path.join(root, hash(reference.authority)), 'dir');
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/link|escape|directory/i);
    await expect(store.read(reference)).rejects.toThrow(/link|escape|directory/i);
    await rm(path.join(root, hash(reference.authority)));
    await store.publish({ reference, manifest, files });
    const filename = archivePath(root, reference);
    await rm(filename);
    const outsideFile = path.join(outside, 'user-authored.json');
    await writeFile(outsideFile, 'Keep this user file.');
    await symlink(outsideFile, filename);
    await expect(store.read(reference)).rejects.toThrow(/link|escape|archive/i);
    await expect(store.publish({ reference, manifest, files })).rejects.toThrow(/link|escape|archive/i);
    expect(await readFile(outsideFile, 'utf8')).toBe('Keep this user file.');
  });
});
