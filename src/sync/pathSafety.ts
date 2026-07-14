/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type { SyncManifest } from './types.js';

interface EnabledSyncRoot {
  path: string;
  directory: boolean;
}

type UnknownRecord = Record<string, unknown>;

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\..*)?$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidManifest(reason: string): Error {
  return new Error(`Invalid sync manifest: ${reason}`);
}

function unsafePath(reason: string): Error {
  return new Error(`Unsafe sync path: ${reason}`);
}

function isContained(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function parseEnabledRoots(enabledRoots: readonly string[]): EnabledSyncRoot[] {
  return enabledRoots.map((root) => {
    const directory = root.endsWith('/');
    const rootPath = directory ? root.slice(0, -1) : root;
    return {
      path: validateSyncPath(rootPath),
      directory,
    };
  });
}

function findEnabledRoot(
  syncPath: string,
  enabledRoots: readonly string[],
): EnabledSyncRoot | undefined {
  return parseEnabledRoots(enabledRoots).find((root) => (
    root.directory
      ? syncPath.startsWith(`${root.path}/`)
      : syncPath === root.path
  ));
}

/**
 * Validate a cloud-sync protocol path without rewriting it.
 */
export function validateSyncPath(syncPath: string): string {
  if (typeof syncPath !== 'string' || syncPath.length === 0) {
    throw unsafePath('path must be non-empty');
  }
  if (/[\u0000-\u001F\u007F]/.test(syncPath)) {
    throw unsafePath('control characters are not allowed');
  }
  if (syncPath.includes('\\')) {
    throw unsafePath('backslashes are not allowed');
  }
  if (path.posix.isAbsolute(syncPath) || /^[A-Za-z]:/.test(syncPath)) {
    throw unsafePath('absolute paths are not allowed');
  }

  const segments = syncPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw unsafePath('empty and relative segments are not allowed');
  }
  if (segments.some((segment) => /[<>:"|?*]/.test(segment))) {
    throw unsafePath('Windows-ambiguous characters are not allowed');
  }
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' '))) {
    throw unsafePath('segments may not end with a dot or space');
  }
  if (segments.some((segment) => WINDOWS_RESERVED_SEGMENT.test(segment))) {
    throw unsafePath('Windows reserved names are not allowed');
  }
  if (path.posix.normalize(syncPath) !== syncPath) {
    throw unsafePath('path must already be normalized');
  }

  return syncPath;
}

/**
 * Validate every manifest key before any individual entry is acted on.
 */
export function validateSyncManifestPaths(
  manifest: unknown,
  enabledRoots: readonly string[],
): asserts manifest is SyncManifest {
  if (!isRecord(manifest)) {
    throw invalidManifest('manifest must be an object');
  }
  if (manifest.version !== 1) {
    throw invalidManifest('unsupported version');
  }
  if (typeof manifest.userId !== 'string' || manifest.userId.length === 0) {
    throw invalidManifest('userId must be a non-empty string');
  }
  if (
    typeof manifest.lastModified !== 'string'
    || Number.isNaN(Date.parse(manifest.lastModified))
  ) {
    throw invalidManifest('lastModified must be a valid timestamp');
  }
  if (typeof manifest.checksum !== 'string' || manifest.checksum.length === 0) {
    throw invalidManifest('checksum must be a non-empty string');
  }
  if (!Array.isArray(manifest.files)) {
    throw invalidManifest('files must be an array');
  }

  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!isRecord(file)) {
      throw invalidManifest('file entries must be objects');
    }
    if (typeof file.path !== 'string') {
      throw invalidManifest('file path must be a string');
    }
    if (typeof file.hash !== 'string' || file.hash.length === 0) {
      throw invalidManifest('file hash must be a non-empty string');
    }
    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0) {
      throw invalidManifest('file size must be a non-negative integer');
    }
    if (
      typeof file.modifiedAt !== 'string'
      || Number.isNaN(Date.parse(file.modifiedAt))
    ) {
      throw invalidManifest('file modifiedAt must be a valid timestamp');
    }
    if (file.encrypted !== undefined && typeof file.encrypted !== 'boolean') {
      throw invalidManifest('file encrypted flag must be boolean');
    }
    const syncPath = validateSyncPath(file.path);
    if (seen.has(syncPath)) {
      throw unsafePath('duplicate manifest path');
    }
    seen.add(syncPath);

    if (!findEnabledRoot(syncPath, enabledRoots)) {
      throw unsafePath('path is outside an enabled sync root');
    }
  }
}

/**
 * Resolve a validated protocol path and reject existing symlink ancestors that
 * leave the selected enabled root.
 */
export async function resolveSafeSyncPath(
  basePath: string,
  relativePath: string,
  enabledRoots: readonly string[],
): Promise<string> {
  const syncPath = validateSyncPath(relativePath);
  const enabledRoot = findEnabledRoot(syncPath, enabledRoots);
  if (!enabledRoot) {
    throw unsafePath('path is outside an enabled sync root');
  }

  const resolvedBase = path.resolve(basePath);
  const destination = path.resolve(resolvedBase, ...syncPath.split('/'));
  if (!isContained(resolvedBase, destination)) {
    throw unsafePath('path resolves outside the sync base');
  }

  const realBase = await fs.realpath(resolvedBase);
  const realRootBoundary = path.resolve(realBase, ...enabledRoot.path.split('/'));
  const segments = syncPath.split('/');
  let existingPath = resolvedBase;

  for (let index = 0; index < segments.length; index++) {
    existingPath = path.join(existingPath, segments[index]);

    let stat: Stats;
    try {
      stat = await fs.lstat(existingPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        break;
      }
      throw error;
    }

    if (!stat.isSymbolicLink()) {
      continue;
    }

    let realTarget: string;
    try {
      realTarget = await fs.realpath(existingPath);
    } catch {
      throw unsafePath('symlink ancestor cannot be resolved');
    }

    const reachedEnabledRoot = index >= enabledRoot.path.split('/').length - 1;
    const boundary = reachedEnabledRoot ? realRootBoundary : realBase;
    if (!isContained(boundary, realTarget)) {
      throw unsafePath('symlink ancestor points outside its enabled sync root');
    }
  }

  return destination;
}
