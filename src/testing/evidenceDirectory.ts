/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function assertTestEvidenceDirectory(directory: string): Promise<void> {
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('Evidence output cannot traverse symbolic links or non-directory entries.');
  }
  if (await realpath(directory) !== directory) {
    throw new Error('Evidence output directory changed during capture.');
  }
}

export async function createTestEvidenceDirectory(
  workspaceRoot: string,
  outputDirectory = '.autohand/test-evidence',
): Promise<string> {
  if (!outputDirectory || path.isAbsolute(outputDirectory) || outputDirectory.split(/[\\/]/).includes('..')) {
    throw new Error('Evidence output must be a relative directory without path traversal.');
  }
  const root = await realpath(workspaceRoot);
  let current = root;
  for (const segment of outputDirectory.split(/[\\/]/).filter(segment => segment && segment !== '.')) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    await assertTestEvidenceDirectory(current);
  }
  const directory = await mkdtemp(path.join(current, 'run-'));
  await assertTestEvidenceDirectory(directory);
  return directory;
}
