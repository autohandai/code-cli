import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { link, lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import type { SkillReference, SkillResourceDigest } from './SkillRuntime.js';

export type ExactSkillReference = SkillReference & { revision: string };

export interface SkillRevisionArchive {
  reference: ExactSkillReference;
  manifest: readonly SkillResourceDigest[];
  files: ReadonlyMap<string, Uint8Array>;
}

export interface SkillRevisionPublication {
  reference: ExactSkillReference;
  manifest: readonly SkillResourceDigest[];
  files: ReadonlyMap<string, Uint8Array>;
}

interface StoredSkillRevision {
  version: 1;
  reference: ExactSkillReference;
  manifest: readonly SkillResourceDigest[];
  files: Array<{ path: string; base64: string }>;
}

interface ArchiveLocation {
  directory: string;
  filename: string;
}

const MAX_FILES = 2_048;
const MAX_PACKAGE_BYTES = 16_000_000;
const MAX_PATH_LENGTH = 4_096;
const MAX_IDENTITY_LENGTH = 4_096;
const MAX_ARCHIVE_BYTES = Math.ceil(MAX_PACKAGE_BYTES / 3) * 4 + MAX_FILES * (MAX_PATH_LENGTH * 6 + 256) + 32_768;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;

function digest(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resourcePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH
    || /[\\\u0000-\u001f\u007f]/u.test(value) || /^[a-z]:/i.test(value)
    || value.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid skill resource path.');
  }
}

function identityField(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_IDENTITY_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value) || value.split(/[\\/]/u).some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid skill authority or package identity.');
  }
}

function exactReference(value: SkillReference): ExactSkillReference {
  if (!record(value)) throw new Error('Invalid exact skill reference.');
  identityField(value.authority);
  identityField(value.packageId);
  if (typeof value.revision !== 'string' || !REVISION_PATTERN.test(value.revision)) {
    throw new Error('An exact sha256 skill revision is required.');
  }
  if (value.resource !== undefined) resourcePath(value.resource);
  return { authority: value.authority, packageId: value.packageId, revision: value.revision,
    ...(value.resource !== undefined ? { resource: value.resource } : {}) };
}

function canonicalManifest(value: unknown): SkillResourceDigest[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILES) {
    throw new Error('Skill manifest exceeds the file count budget or is empty.');
  }
  const paths = new Set<string>();
  let bytes = 0;
  const manifest = value.map((entry: unknown): SkillResourceDigest => {
    if (!record(entry)) throw new Error('Invalid skill manifest entry.');
    resourcePath(entry.path);
    if (paths.has(entry.path)) throw new Error('Skill manifest contains a duplicate resource path.');
    paths.add(entry.path);
    if (typeof entry.sha256 !== 'string' || !DIGEST_PATTERN.test(entry.sha256)) throw new Error('Invalid skill manifest digest.');
    if (typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Invalid skill resource bytes.');
    bytes += entry.bytes;
    if (bytes > MAX_PACKAGE_BYTES) throw new Error('Skill package exceeds the bytes budget.');
    return { path: entry.path, sha256: entry.sha256, bytes: entry.bytes };
  }).sort((a, b) => compare(a.path, b.path));
  if (!paths.has('SKILL.md')) throw new Error('Skill package has no SKILL.md.');
  return manifest;
}

export function computeSkillRevision(manifest: readonly SkillResourceDigest[]): string {
  return `sha256:${digest(JSON.stringify(canonicalManifest(manifest)))}`;
}

export function createSkillRevisionManifest(files: ReadonlyMap<string, Uint8Array>): SkillResourceDigest[] {
  if (!Number.isSafeInteger(files.size) || files.size === 0 || files.size > MAX_FILES) {
    throw new Error('Skill package exceeds the file count budget or is empty.');
  }
  let bytes = 0;
  const manifest: SkillResourceDigest[] = [];
  for (const [resource, content] of files) {
    resourcePath(resource);
    if (!(content instanceof Uint8Array)) throw new Error('Invalid skill file bytes.');
    bytes += content.byteLength;
    if (bytes > MAX_PACKAGE_BYTES || manifest.length >= MAX_FILES) throw new Error('Skill package exceeds the resource budget.');
    manifest.push({ path: resource, sha256: digest(content), bytes: content.byteLength });
  }
  return canonicalManifest(manifest);
}

function publicationSnapshot(publication: SkillRevisionPublication): SkillRevisionArchive {
  const reference = exactReference(publication.reference);
  const manifest = canonicalManifest(publication.manifest);
  if (!Number.isSafeInteger(publication.files.size) || publication.files.size === 0 || publication.files.size > MAX_FILES) {
    throw new Error('Skill package exceeds the file count budget or is empty.');
  }
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  for (const [resource, content] of publication.files) {
    resourcePath(resource);
    if (!(content instanceof Uint8Array)) throw new Error('Invalid skill file bytes.');
    bytes += content.byteLength;
    if (bytes > MAX_PACKAGE_BYTES || files.size >= MAX_FILES) throw new Error('Skill package exceeds the resource budget.');
    files.set(resource, new Uint8Array(content));
  }
  const actual = createSkillRevisionManifest(files);
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('Skill files disagree with the manifest digests or bytes.');
  if (computeSkillRevision(manifest) !== reference.revision) throw new Error('Skill manifest does not match the exact revision.');
  if (reference.resource !== undefined && !files.has(reference.resource)) throw new Error('Pinned skill resource is unavailable.');
  return { reference, manifest, files: new Map(manifest.map(resource => [resource.path, files.get(resource.path)!])) };
}

async function directory(location: string, create: boolean): Promise<string | null> {
  if (create) await mkdir(location, { recursive: false, mode: 0o700 }).catch(error => {
    if (errorCode(error) !== 'EEXIST') throw error;
  });
  let info;
  try { info = await lstat(location); } catch (error) {
    if (!create && errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Skill archive directory is invalid or a symbolic link.');
  return realpath(location);
}

async function boundedRead(filename: string): Promise<string | null> {
  let initial;
  try { initial = await lstat(filename); } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (initial.isSymbolicLink() || !initial.isFile()) throw new Error('Skill archive is an invalid file or symbolic link.');
  let handle: FileHandle;
  try { handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw new Error('Cannot read skill archive; it may be a symbolic link or invalid file.', { cause: error });
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== initial.dev || info.ino !== initial.ino || info.size > MAX_ARCHIVE_BYTES) {
      throw new Error('Skill archive file changed, exceeds its bytes budget, or is invalid.');
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65_536, MAX_ARCHIVE_BYTES - bytes + 1));
      const read = await handle.read(chunk, 0, chunk.length, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error('Skill archive exceeds its bytes budget.');
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } finally {
    await handle.close();
  }
}

function decodeArchive(content: string, requested: ExactSkillReference): SkillRevisionArchive {
  let stored: unknown;
  try { stored = JSON.parse(content); } catch (error) { throw new Error('Corrupt skill revision archive JSON.', { cause: error }); }
  if (!record(stored) || stored.version !== 1 || !record(stored.reference) || !Array.isArray(stored.files)
    || stored.files.length > MAX_FILES) throw new Error('Invalid skill revision archive.');
  const reference = exactReference(stored.reference as unknown as SkillReference);
  if (reference.authority !== requested.authority || reference.packageId !== requested.packageId
    || reference.revision !== requested.revision || reference.resource !== undefined) {
    throw new Error('Skill archive reference disagrees with its exact identity.');
  }
  const manifest = canonicalManifest(stored.manifest);
  if (stored.files.length !== manifest.length) throw new Error('Skill archive file count disagrees with its manifest.');
  const resources = new Map(manifest.map(resource => [resource.path, resource]));
  const files = new Map<string, Uint8Array>();
  for (const value of stored.files) {
    if (!record(value)) throw new Error('Invalid skill archive file.');
    resourcePath(value.path);
    if (files.has(value.path) || typeof value.base64 !== 'string') throw new Error('Invalid or duplicate skill archive file.');
    const resource = resources.get(value.path);
    if (!resource || value.base64.length !== Math.ceil(resource.bytes / 3) * 4) throw new Error('Skill archive bytes disagree with its manifest.');
    const bytes = Buffer.from(value.base64, 'base64');
    if (bytes.toString('base64') !== value.base64) throw new Error('Invalid skill archive binary encoding.');
    files.set(value.path, new Uint8Array(bytes));
  }
  return publicationSnapshot({ reference: requested, manifest, files });
}

async function syncDirectory(location: string): Promise<void> {
  const handle = await open(location, 'r');
  try { await handle.sync(); } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(errorCode(error) ?? '')) throw error;
  } finally { await handle.close(); }
}

async function removeOwnedStage(staged: string, original: { dev: number; ino: number }): Promise<void> {
  const parent = path.dirname(staged);
  const canonicalParent = await directory(parent, false).catch(() => null);
  if (canonicalParent !== parent) return;
  const current = await lstat(staged).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error;
    return null;
  });
  if (current?.isDirectory() && current.dev === original.dev && current.ino === original.ino) {
    await rm(staged, { recursive: true, force: true });
  }
}

export class SkillRevisionStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private async location(reference: ExactSkillReference, create: boolean): Promise<ArchiveLocation | null> {
    if (create) await mkdir(path.dirname(this.root), { recursive: true, mode: 0o700 });
    const root = await directory(this.root, create);
    if (root === null) return null;
    let parent = root;
    for (const identifier of [reference.authority, reference.packageId]) {
      const expected = path.join(parent, digest(identifier));
      const resolved = await directory(expected, create);
      if (resolved === null) return null;
      if (resolved !== expected) throw new Error('Skill archive directory escapes its store.');
      parent = resolved;
    }
    return { directory: parent, filename: path.join(parent, `${reference.revision.slice(7)}.json`) };
  }

  async read(reference: SkillReference): Promise<SkillRevisionArchive | null> {
    const requested = exactReference(reference);
    const location = await this.location(requested, false);
    if (!location) return null;
    const content = await boundedRead(location.filename);
    return content === null ? null : decodeArchive(content, requested);
  }

  async publish(publication: SkillRevisionPublication): Promise<SkillRevisionArchive> {
    const snapshot = publicationSnapshot(publication);
    const location = (await this.location(snapshot.reference, true))!;
    const lockPath = `${location.filename}.lock`;
    await lstat(lockPath).then(info => {
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Invalid skill archive publication lock.');
    }).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
    return withFileLock(lockPath, async () => {
      const existing = await this.read(snapshot.reference);
      if (existing) return existing;
      const staged = await mkdtemp(path.join(location.directory, '.staged-'));
      const stagedIdentity = await lstat(staged);
      try {
        const filename = path.join(staged, 'archive.json');
        const stored: StoredSkillRevision = { version: 1,
          reference: { authority: snapshot.reference.authority, packageId: snapshot.reference.packageId, revision: snapshot.reference.revision },
          manifest: snapshot.manifest,
          files: [...snapshot.files].map(([resource, bytes]) => ({ path: resource, base64: Buffer.from(bytes).toString('base64') })) };
        await atomicWriteJson(filename, stored);
        const current = await this.location(snapshot.reference, false);
        if (!current || current.filename !== location.filename) throw new Error('Skill archive directory changed during publication.');
        try { await link(filename, location.filename); } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
        }
        await syncDirectory(location.directory);
        const committed = await this.read(snapshot.reference);
        if (!committed) throw new Error('Skill revision archive disappeared during publication.');
        return committed;
      } finally {
        await removeOwnedStage(staged, stagedIdentity);
      }
    }, { waitTimeoutMs: 10_000 });
  }
}
