/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import crypto from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';

const DEFAULT_STALE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 25;
const LOCK_OWNER_SUFFIX = '.owner';

interface LockRecord {
  version: 1;
  ownerId: string;
  pid: number;
  createdAt: number;
}

interface LockSnapshot {
  ownerId?: string;
  pid?: number;
  createdAt: number;
}

interface DirectoryLockOwner {
  fileName: string;
  snapshot: LockSnapshot;
}

interface DirectoryLockSnapshot {
  createdAt: number;
  owners: DirectoryLockOwner[];
  hasUnknownEntries: boolean;
}

type LockArtifactStatus = 'missing' | 'active' | 'stale';

export interface FileLockOptions {
  staleMs?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
}

export interface FileLockLease {
  readonly ownerId: string;
  release(): Promise<void>;
}

export interface AtomicCommitOptions {
  beforeCommit?: () => void;
}

export type AtomicWriteJsonOptions = AtomicCommitOptions;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLockSnapshot(lockPath: string): Promise<LockSnapshot | null> {
  try {
    const [content, stat] = await Promise.all([
      nodeFs.readFile(lockPath, 'utf8'),
      nodeFs.stat(lockPath),
    ]);
    const legacyTimestamp = Number(content.trim());
    if (Number.isFinite(legacyTimestamp)) {
      return { createdAt: legacyTimestamp };
    }

    try {
      const parsed = JSON.parse(content) as Partial<LockRecord>;
      return {
        ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
        pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : stat.mtimeMs,
      };
    } catch {
      return { createdAt: stat.mtimeMs };
    }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return null;
    }
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

function isStale(snapshot: LockSnapshot, staleMs: number): boolean {
  if (Date.now() - snapshot.createdAt < staleMs) {
    return false;
  }
  return snapshot.pid === undefined || !processIsAlive(snapshot.pid);
}

async function createOwnerFile(ownerPath: string, record: LockRecord): Promise<void> {
  let handle: FileHandle | null = null;
  let created = false;
  try {
    handle = await nodeFs.open(ownerPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) {
      await nodeFs.unlink(ownerPath).catch(() => {});
    }
    throw error;
  }
}

async function releaseOwnedLock(lockPath: string, ownerId: string): Promise<void> {
  const ownerPath = path.join(lockPath, `${ownerId}${LOCK_OWNER_SUFFIX}`);
  try {
    await nodeFs.unlink(ownerPath);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return;
    }
    throw error;
  }

  try {
    await nodeFs.rmdir(lockPath);
  } catch (error) {
    if (['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return;
    }
    if (errorCode(error) === 'EPERM' && await directoryHasEntries(lockPath) !== false) {
      return;
    }
    throw error;
  }
}

async function directoryHasEntries(directoryPath: string): Promise<boolean | null> {
  try {
    return (await nodeFs.readdir(directoryPath)).length > 0;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return null;
    }
    throw error;
  }
}

async function tryCreateDirectoryLock(
  lockPath: string,
  record: LockRecord,
): Promise<FileLockLease | null> {
  try {
    await nodeFs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return null;
    }
    throw error;
  }

  const ownerPath = path.join(lockPath, `${record.ownerId}${LOCK_OWNER_SUFFIX}`);
  try {
    await createOwnerFile(ownerPath, record);
    await syncDirectory(lockPath);
  } catch (error) {
    await nodeFs.unlink(ownerPath).catch(() => {});
    await nodeFs.rmdir(lockPath).catch(() => {});
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return null;
    }
    throw error;
  }

  return {
    ownerId: record.ownerId,
    release: () => releaseOwnedLock(lockPath, record.ownerId),
  };
}

async function readDirectoryLockSnapshot(lockPath: string): Promise<DirectoryLockSnapshot | null> {
  let stat: Stats;
  try {
    stat = await nodeFs.lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    return null;
  }

  let entries: Dirent[];
  try {
    entries = await nodeFs.readdir(lockPath, { withFileTypes: true });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return null;
    }
    throw error;
  }

  const owners: DirectoryLockOwner[] = [];
  let hasUnknownEntries = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(LOCK_OWNER_SUFFIX)) {
      hasUnknownEntries = true;
      continue;
    }
    const snapshot = await readLockSnapshot(path.join(lockPath, entry.name));
    if (snapshot) {
      owners.push({ fileName: entry.name, snapshot });
    }
  }

  return {
    createdAt: stat.mtimeMs,
    owners,
    hasUnknownEntries,
  };
}

function directoryLockIsStale(snapshot: DirectoryLockSnapshot, staleMs: number): boolean {
  if (snapshot.hasUnknownEntries) {
    return false;
  }
  if (snapshot.owners.length === 0) {
    return Date.now() - snapshot.createdAt >= staleMs;
  }
  return snapshot.owners.every((owner) => isStale(owner.snapshot, staleMs));
}

function snapshotsMatch(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.ownerId === right.ownerId
    && left.pid === right.pid
    && left.createdAt === right.createdAt;
}

async function getLockArtifactStatus(
  lockPath: string,
  staleMs: number,
): Promise<LockArtifactStatus> {
  let stat;
  try {
    stat = await nodeFs.lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }

  if (stat.isDirectory()) {
    const directory = await readDirectoryLockSnapshot(lockPath);
    if (!directory) {
      return 'missing';
    }
    return directoryLockIsStale(directory, staleMs) ? 'stale' : 'active';
  }

  const legacy = await readLockSnapshot(lockPath);
  if (!legacy) {
    return 'missing';
  }
  return isStale(legacy, staleMs) ? 'stale' : 'active';
}

async function removeStaleDirectoryLock(lockPath: string, staleMs: number): Promise<boolean> {
  const directory = await readDirectoryLockSnapshot(lockPath);
  if (!directory || !directoryLockIsStale(directory, staleMs)) {
    return false;
  }

  for (const owner of directory.owners) {
    const ownerPath = path.join(lockPath, owner.fileName);
    const current = await readLockSnapshot(ownerPath);
    if (!current) {
      continue;
    }
    if (!snapshotsMatch(current, owner.snapshot) || !isStale(current, staleMs)) {
      return false;
    }
    await nodeFs.unlink(ownerPath).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
    });
  }

  try {
    await nodeFs.rmdir(lockPath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    if (['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      return false;
    }
    if (errorCode(error) === 'EPERM' && await directoryHasEntries(lockPath) !== false) {
      return false;
    }
    throw error;
  }
}

async function removeStaleLegacyLock(lockPath: string, staleMs: number): Promise<boolean> {
  let before: Stats;
  try {
    before = await nodeFs.lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    throw error;
  }
  if (before.isDirectory()) {
    return false;
  }

  const stale = await readLockSnapshot(lockPath);
  if (!stale || !isStale(stale, staleMs)) {
    return false;
  }

  let current: Stats;
  try {
    current = await nodeFs.lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    throw error;
  }
  if (
    current.isDirectory()
    || current.dev !== before.dev
    || current.ino !== before.ino
    || current.size !== before.size
    || current.mtimeMs !== before.mtimeMs
  ) {
    return false;
  }

  try {
    await nodeFs.unlink(lockPath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    if (errorCode(error) === 'EISDIR') {
      return false;
    }
    throw error;
  }
}

async function removeStaleLockArtifact(lockPath: string, staleMs: number): Promise<boolean> {
  let stat: Stats;
  try {
    stat = await nodeFs.lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    throw error;
  }
  return stat.isDirectory()
    ? removeStaleDirectoryLock(lockPath, staleMs)
    : removeStaleLegacyLock(lockPath, staleMs);
}

async function acquireReaperLock(
  reaperPath: string,
  record: LockRecord,
  staleMs: number,
): Promise<FileLockLease | null> {
  const direct = await tryCreateDirectoryLock(reaperPath, record);
  if (direct) {
    return direct;
  }
  if (await getLockArtifactStatus(reaperPath, staleMs) !== 'stale') {
    return null;
  }
  if (!await removeStaleLockArtifact(reaperPath, staleMs)) {
    return null;
  }
  return tryCreateDirectoryLock(reaperPath, record);
}

async function reapStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  const reaperPath = `${lockPath}.reaper`;
  const reaperRecord: LockRecord = {
    version: 1,
    ownerId: crypto.randomUUID(),
    pid: process.pid,
    createdAt: Date.now(),
  };
  const reaper = await acquireReaperLock(reaperPath, reaperRecord, staleMs);
  if (!reaper) {
    return false;
  }

  try {
    return await removeStaleLockArtifact(lockPath, staleMs);
  } finally {
    await reaper.release();
  }
}

export async function acquireFileLock(
  lockPath: string,
  options: FileLockOptions = {},
): Promise<FileLockLease | null> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? 0;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const deadline = Date.now() + waitTimeoutMs;
  const ownerId = crypto.randomUUID();

  await fs.ensureDir(path.dirname(lockPath));

  while (true) {
    const record: LockRecord = {
      version: 1,
      ownerId,
      pid: process.pid,
      createdAt: Date.now(),
    };
    const lease = await tryCreateDirectoryLock(lockPath, record);
    if (lease) {
      return lease;
    }

    const status = await getLockArtifactStatus(lockPath, staleMs);
    if (status === 'missing') {
      continue;
    }
    if (status === 'stale') {
      if (await reapStaleLock(lockPath, staleMs)) {
        continue;
      }
      if (await getLockArtifactStatus(lockPath, staleMs) === 'missing') {
        continue;
      }
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(retryDelayMs);
  }
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lease = await acquireFileLock(lockPath, options);
  if (!lease) {
    throw new Error(`Timed out waiting for file lock: ${path.basename(lockPath)}`);
  }
  try {
    return await operation();
  } finally {
    await lease.release();
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await nodeFs.open(directoryPath, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(errorCode(error) ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: AtomicWriteJsonOptions = {},
): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error('Cannot serialize undefined as JSON');
  }

  await atomicWriteFile(filePath, `${serialized}\n`, options);
}

export async function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicCommitOptions = {},
): Promise<void> {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle: FileHandle | null = null;
  let renamed = false;

  await fs.ensureDir(directoryPath);
  try {
    const existingMode = await nodeFs.stat(filePath)
      .then((stat) => stat.mode & 0o777)
      .catch(() => 0o600);
    handle = await nodeFs.open(temporaryPath, 'wx', existingMode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    options.beforeCommit?.();
    await nodeFs.rename(temporaryPath, filePath);
    renamed = true;
    await syncDirectory(directoryPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (!renamed) {
      await nodeFs.unlink(temporaryPath).catch(() => {});
    }
    throw error;
  }
}

export async function atomicRemoveFile(
  filePath: string,
  options: AtomicCommitOptions = {},
): Promise<void> {
  const directoryPath = path.dirname(filePath);
  const tombstonePath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tombstone`,
  );

  options.beforeCommit?.();
  try {
    await nodeFs.rename(filePath, tombstonePath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }

  try {
    await syncDirectory(directoryPath);
  } finally {
    await nodeFs.unlink(tombstonePath).catch(() => {});
    await syncDirectory(directoryPath).catch(() => {});
  }
}
