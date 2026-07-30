/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkspaceFileCollector,
  isSafeMobileWorkspaceRelativePath,
} from '../../../src/core/agent/WorkspaceFileCollector.js';
import { GitIgnoreParser } from '../../../src/utils/gitIgnore.js';

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-files-'));
  temporaryDirectories.push(workspace);
  return workspace;
}

async function createFile(workspace: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(workspace, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `fixture:${relativePath}`, 'utf8');
}

describe('WorkspaceFileCollector mobile filename query', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it('returns a deterministic bounded top-N list containing paths but no file contents', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/mobile/MobileRelay.ts');
    await createFile(workspace, 'tests/mobile/MobileRelay.test.ts');
    await createFile(workspace, 'docs/mobile-relay.md');
    await createFile(workspace, 'src/unrelated.ts');
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    const result = await collector.queryWorkspaceFiles('MobileRelay', {
      limit: 2,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      query: 'MobileRelay',
      files: [
        { relativePath: 'src/mobile/MobileRelay.ts' },
        { relativePath: 'tests/mobile/MobileRelay.test.ts' },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain('fixture:');
  });

  it('denies secret paths, traversal forms, absolute paths, and symlink escapes', async () => {
    const workspace = await createWorkspace();
    const outside = await createWorkspace();
    await createFile(workspace, 'src/Safe.swift');
    await createFile(workspace, '.env.local');
    await createFile(workspace, 'config/secrets.json');
    await createFile(workspace, 'keys/private.pem');
    await createFile(outside, 'Outside.swift');
    await symlink(outside, path.join(workspace, 'escaped'));
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    const result = await collector.queryWorkspaceFiles('', {
      limit: 20,
      timeoutMs: 1_000,
    });

    expect(result.files).toEqual([{ relativePath: 'src/Safe.swift' }]);
    expect(isSafeMobileWorkspaceRelativePath('src/Safe.swift')).toBe(true);
    expect(isSafeMobileWorkspaceRelativePath('../secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('/Users/example/secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('C:\\Users\\example\\secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('.env.production')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('config/secrets.json')).toBe(false);
  });

  it('refreshes the workspace inventory for each relay-scoped query', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/Existing.ts');
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    await collector.queryWorkspaceFiles('Existing', {
      limit: 8,
      timeoutMs: 1_000,
    });
    await createFile(workspace, 'src/JustCreatedRelayFile.ts');

    await expect(collector.queryWorkspaceFiles('JustCreatedRelayFile', {
      limit: 8,
      timeoutMs: 1_000,
    })).resolves.toEqual({
      query: 'JustCreatedRelayFile',
      files: [{ relativePath: 'src/JustCreatedRelayFile.ts' }],
      truncated: false,
    });
  });

  it('returns a bounded empty result when collection exceeds the query deadline', async () => {
    const workspace = await createWorkspace();
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));
    collector.collectWorkspaceFiles = () => new Promise<string[]>(() => {});

    await expect(collector.queryWorkspaceFiles('relay', {
      limit: 8,
      timeoutMs: 5,
    })).resolves.toEqual({
      query: 'relay',
      files: [],
      truncated: true,
    });
  });
});
