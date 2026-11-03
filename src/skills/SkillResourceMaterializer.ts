import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { link, lstat, mkdir, mkdtemp, open, opendir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { createSkillRevisionManifest, computeSkillRevision } from './SkillRevisionStore.js';
import type { SkillRevisionArchive } from './SkillRevisionStore.js';

const MAX_FILES = 2_048;
const MAX_PACKAGE_BYTES = 16_000_000;
const MAX_DIRECTORIES = 8_192;
const MAX_PUBLICATION_BYTES = 32_768;

interface Publication {
  version: 1;
  directory: string;
  reference: { authority: string; packageId: string; revision: string };
}

interface Snapshot extends SkillRevisionArchive {
  directories: ReadonlySet<string>;
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function snapshotArchive(archive: SkillRevisionArchive): Snapshot {
  const { authority, packageId, revision } = archive.reference;
  for (const identifier of [authority, packageId]) {
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 4_096
      || /[\u0000-\u001f\u007f]/u.test(identifier) || identifier.split(/[\\/]/u).some(segment => segment === '.' || segment === '..')) {
      throw new Error('Invalid skill resource package identity.');
    }
  }
  createSkillRevisionManifest(archive.files);
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  for (const [resource, content] of archive.files) {
    bytes += content.byteLength;
    if (files.size >= MAX_FILES || bytes > MAX_PACKAGE_BYTES) throw new Error('Skill resource package exceeds its bytes or count budget.');
    files.set(resource, new Uint8Array(content));
  }
  const manifest = createSkillRevisionManifest(files);
  if (!/^sha256:[a-f0-9]{64}$/u.test(revision) || computeSkillRevision(manifest) !== revision
    || computeSkillRevision(archive.manifest) !== revision) throw new Error('Skill resource archive revision or manifest is invalid.');
  if (archive.reference.resource !== undefined && !files.has(archive.reference.resource)) throw new Error('Pinned skill resource is missing from its manifest.');
  const directories = new Set<string>();
  for (const resource of manifest) {
    const segments = resource.path.split('/');
    for (let count = 1; count < segments.length; count++) {
      directories.add(segments.slice(0, count).join('/'));
      if (directories.size > MAX_DIRECTORIES) throw new Error('Skill resource directories exceed their count budget.');
    }
  }
  return { reference: { ...archive.reference }, manifest, files, directories };
}

async function safeDirectory(directory: string, create: boolean): Promise<string | null> {
  if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (errorCode(error) !== 'EEXIST') throw error; });
  let info;
  try { info = await lstat(directory); } catch (error) {
    if (!create && errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid or symbolic-link skill resource directory.');
  return realpath(directory);
}

async function readBounded(filename: string, limit: number): Promise<Buffer | null> {
  let before;
  try { before = await lstat(filename); } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid or symbolic-link skill resource file.');
  let handle: FileHandle | undefined;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > limit) {
      throw new Error('Skill resource bytes exceed their manifest or the file changed.');
    }
    const chunks: Buffer[] = [];
    let length = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65_536, limit - length + 1));
      const read = await handle.read(chunk, 0, chunk.length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
      if (length > limit) throw new Error('Skill resource bytes exceed their manifest budget.');
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    return Buffer.concat(chunks, length);
  } finally { await handle?.close(); }
}

function fileMode(content: Uint8Array): number {
  return content[0] === 35 && content[1] === 33 ? 0o700 : 0o600;
}

async function writeResource(filename: string, content: Uint8Array): Promise<void> {
  const handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, fileMode(content));
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(errorCode(error) ?? '')) throw error;
  } finally { await handle.close(); }
}

async function verifyPackage(root: string, snapshot: Snapshot): Promise<void> {
  const canonical = await safeDirectory(root, false);
  if (canonical !== root) throw new Error('Skill resource package directory is missing or escapes its cache.');
  const expected = new Map(snapshot.manifest.map(resource => [resource.path, resource]));
  const visited = new Set<string>();
  let directories = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for await (const entry of await opendir(directory)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Skill resource package contains a symbolic link.');
      if (entry.isDirectory()) {
        if (!snapshot.directories.has(relative) || ++directories > MAX_DIRECTORIES) throw new Error('Unexpected directory in skill resource manifest.');
        if (await safeDirectory(filename, false) !== filename) throw new Error('Skill resource directory escapes its cache.');
        await walk(filename, relative);
        continue;
      }
      const resource = expected.get(relative);
      if (!entry.isFile() || !resource) throw new Error('Unexpected file in skill resource manifest.');
      const bytes = await readBounded(filename, resource.bytes);
      if (!bytes || bytes.byteLength !== resource.bytes || digest(bytes) !== resource.sha256) throw new Error('Corrupt skill resource digest or bytes.');
      if (((await lstat(filename)).mode & 0o777) !== fileMode(bytes)) throw new Error('Corrupt skill resource permissions.');
      visited.add(relative);
    }
  };
  await walk(root, '');
  if (visited.size !== expected.size) throw new Error('Skill resource manifest contains missing files.');
}

async function removeOwnedStage(directory: string, original: { ino: number; dev: number }): Promise<void> {
  const parent = path.dirname(directory);
  if (await safeDirectory(parent, false).catch(() => null) !== parent) return;
  const current = await lstat(directory).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error;
    return null;
  });
  if (current?.isDirectory() && current.ino === original.ino && current.dev === original.dev) await rm(directory, { recursive: true, force: true });
}

export class SkillResourceMaterializer {
  private readonly root: string;

  constructor(root: string) { this.root = path.resolve(root); }

  private async partition(snapshot: Snapshot): Promise<string> {
    await mkdir(path.dirname(this.root), { recursive: true, mode: 0o700 });
    const root = (await safeDirectory(this.root, true))!;
    let parent = root;
    for (const segment of [digest(snapshot.reference.authority), digest(snapshot.reference.packageId), snapshot.reference.revision.slice(7)]) {
      const expected = path.join(parent, segment);
      const actual = await safeDirectory(expected, true);
      if (actual !== expected) throw new Error('Skill resource directory escapes its cache.');
      parent = actual;
    }
    return parent;
  }

  private async readPublication(partition: string, snapshot: Snapshot): Promise<string | null> {
    const content = await readBounded(path.join(partition, 'publication.json'), MAX_PUBLICATION_BYTES);
    if (content === null) return null;
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
    catch (error) { throw new Error('Corrupt skill resource publication.', { cause: error }); }
    if (!isRecord(value) || value.version !== 1 || typeof value.directory !== 'string'
      || !/^\.package-[A-Za-z0-9_-]{6,80}$/u.test(value.directory) || !isRecord(value.reference)
      || value.reference.authority !== snapshot.reference.authority || value.reference.packageId !== snapshot.reference.packageId
      || value.reference.revision !== snapshot.reference.revision) throw new Error('Invalid skill resource publication directory or reference.');
    const object = path.join(partition, value.directory);
    if (await safeDirectory(object, false) !== object) throw new Error('Skill resource publication directory is missing or escapes its cache.');
    const packageRoot = path.join(object, 'package');
    await verifyPackage(packageRoot, snapshot);
    return packageRoot;
  }

  async verify(archive: SkillRevisionArchive, expectedRoot: string): Promise<void> {
    const snapshot = snapshotArchive(archive);
    let parent = await safeDirectory(this.root, false);
    if (parent === null) throw new Error('Pinned skill resource root is missing.');
    for (const segment of [digest(snapshot.reference.authority), digest(snapshot.reference.packageId), snapshot.reference.revision.slice(7)]) {
      const expected = path.join(parent, segment);
      const actual = await safeDirectory(expected, false);
      if (actual !== expected) throw new Error('Pinned skill resource publication is missing or escapes its cache.');
      parent = actual;
    }
    const published = await this.readPublication(parent, snapshot);
    if (published === null || published !== path.resolve(expectedRoot)) throw new Error('Pinned skill resource publication root changed or is missing.');
  }

  async materialize(archive: SkillRevisionArchive): Promise<string> {
    const snapshot = snapshotArchive(archive);
    const partition = await this.partition(snapshot);
    const lock = path.join(partition, 'publication.lock');
    await lstat(lock).then(info => {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid skill resource publication lock.');
    }).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
    return withFileLock(lock, async () => {
      const existing = await this.readPublication(partition, snapshot);
      if (existing) return existing;
      const staged = await mkdtemp(path.join(partition, '.package-'));
      const original = await lstat(staged);
      let published = false;
      try {
        const packageRoot = path.join(staged, 'package');
        await safeDirectory(packageRoot, true);
        for (const directory of snapshot.directories) {
          const target = path.join(packageRoot, ...directory.split('/'));
          if (await safeDirectory(target, true) !== target) throw new Error('Skill resource directory escapes its package.');
        }
        for (const [resource, content] of snapshot.files) await writeResource(path.join(packageRoot, ...resource.split('/')), content);
        for (const directory of [...snapshot.directories].reverse()) await syncDirectory(path.join(packageRoot, ...directory.split('/')));
        await syncDirectory(packageRoot);
        await verifyPackage(packageRoot, snapshot);
        const record: Publication = { version: 1, directory: path.basename(staged), reference: {
          authority: snapshot.reference.authority, packageId: snapshot.reference.packageId, revision: snapshot.reference.revision,
        } };
        const pointer = path.join(staged, 'publication.json');
        await atomicWriteJson(pointer, record);
        if (await this.partition(snapshot) !== partition) throw new Error('Skill resource partition changed during publication.');
        try { await link(pointer, path.join(partition, 'publication.json')); published = true; }
        catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
        await syncDirectory(partition);
        const committed = await this.readPublication(partition, snapshot);
        if (!committed) throw new Error('Skill resource publication disappeared.');
        if (committed === packageRoot) published = true;
        return committed;
      } finally {
        if (!published) await removeOwnedStage(staged, original);
      }
    }, { waitTimeoutMs: 10_000 });
  }
}
