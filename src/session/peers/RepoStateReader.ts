/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fse from 'fs-extra';

export interface RepoHead {
  branch: string | null;
  sha: string;
}

interface GitDirectories {
  gitDir: string;
  commonDir: string;
}

export async function readRepoHead(workspaceRoot: string): Promise<RepoHead | null> {
  const directories = await resolveGitDirectories(workspaceRoot);
  if (!directories) {
    return null;
  }

  const head = await readTrimmed(path.join(directories.gitDir, 'HEAD'));
  if (!head) {
    return null;
  }

  const symbolic = /^ref:\s*(.+)$/u.exec(head);
  if (!symbolic) {
    return { branch: null, sha: head };
  }

  const ref = symbolic[1]?.trim();
  if (!ref || !isSafeGitRef(ref)) {
    return null;
  }
  const branch = ref.startsWith('refs/heads/')
    ? ref.slice('refs/heads/'.length)
    : ref;
  const refRoots = directories.gitDir === directories.commonDir
    ? [directories.gitDir]
    : [directories.gitDir, directories.commonDir];

  for (const root of refRoots) {
    const loose = await readTrimmed(path.join(root, ...ref.split('/')));
    if (loose) {
      return { branch, sha: loose };
    }
  }

  for (const root of refRoots) {
    const packed = await readTrimmed(path.join(root, 'packed-refs'));
    const sha = packed ? findPackedRef(packed, ref) : null;
    if (sha) {
      return { branch, sha };
    }
  }

  return null;
}

async function resolveGitDirectories(workspaceRoot: string): Promise<GitDirectories | null> {
  const dotGit = path.join(workspaceRoot, '.git');
  let gitDir = dotGit;

  try {
    const stats = await fse.stat(dotGit);
    if (stats.isFile()) {
      const pointer = await readTrimmed(dotGit);
      const match = pointer ? /^gitdir:\s*(.+)$/iu.exec(pointer) : null;
      if (!match?.[1]) {
        return null;
      }
      gitDir = path.resolve(workspaceRoot, match[1].trim());
    } else if (!stats.isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  const commonPointer = await readTrimmed(path.join(gitDir, 'commondir'));
  const commonDir = commonPointer
    ? path.resolve(gitDir, commonPointer)
    : gitDir;
  return { gitDir, commonDir };
}

function isSafeGitRef(ref: string): boolean {
  return ref.startsWith('refs/')
    && !ref.includes('\\')
    && !ref.split('/').includes('..');
}

function findPackedRef(contents: string, ref: string): string | null {
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) {
      continue;
    }
    const [sha, name] = trimmed.split(/\s+/u);
    if (name === ref && sha) {
      return sha;
    }
  }
  return null;
}

async function readTrimmed(filePath: string): Promise<string | null> {
  try {
    const contents = await fse.readFile(filePath, 'utf8');
    const trimmed = contents.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
