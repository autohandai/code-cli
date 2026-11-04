import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSkillWorkspaceIdentity, readSkillWorkspaceIdentity } from '../../src/skills/workspaceIdentity.js';

describe('portable skill workspace identity', () => {
  let parent: string;
  let root: string;
  beforeEach(async () => { parent = await mkdtemp(path.join(os.tmpdir(), 'autohand-workspace-identity-')); root = path.join(parent, 'repo'); await mkdir(root); });
  afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

  it('keeps lookup read-only and never recreates a missing historical root', async () => {
    expect(await readSkillWorkspaceIdentity(root)).toBeNull();
    await expect(stat(path.join(root, '.autohand'))).rejects.toMatchObject({ code: 'ENOENT' });
    const missing = path.join(parent, 'historical');
    await expect(ensureSkillWorkspaceIdentity(missing)).rejects.toThrow();
    expect(await readSkillWorkspaceIdentity(missing)).toBeNull();
    await expect(stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates one complete identity atomically under concurrent callers and preserves it on relocation', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => ensureSkillWorkspaceIdentity(root)));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
    const identityPath = path.join(root, '.autohand/workspace-identity.json');
    expect(JSON.parse(await readFile(identityPath, 'utf8'))).toEqual({ version: 1, id: ids[0] });
    expect((await stat(identityPath)).mode & 0o777).toBe(0o600);
    const moved = path.join(parent, 'relocated'); await rename(root, moved);
    expect(await readSkillWorkspaceIdentity(moved)).toBe(ids[0]);
    expect(await readSkillWorkspaceIdentity(root)).toBeNull();
  });

  it.each(['not json', '{"version":2,"id":"bad"}', '{"version":1,"id":"bad"}'])('fails without overwriting malformed identity: %s', async bytes => {
    await mkdir(path.join(root, '.autohand')); const target = path.join(root, '.autohand/workspace-identity.json'); await writeFile(target, bytes);
    await expect(readSkillWorkspaceIdentity(root)).rejects.toThrow('identity');
    await expect(ensureSkillWorkspaceIdentity(root)).rejects.toThrow('identity');
    expect(await readFile(target, 'utf8')).toBe(bytes);
  });

  it('rejects symlink roots, metadata directories, and identity files without following their targets', async () => {
    const alias = path.join(parent, 'alias'); await symlink(root, alias);
    await expect(ensureSkillWorkspaceIdentity(alias)).rejects.toThrow('symlink');
    const outside = path.join(parent, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(root, '.autohand'));
    await expect(ensureSkillWorkspaceIdentity(root)).rejects.toThrow('symlink');
    await rm(path.join(root, '.autohand')); await mkdir(path.join(root, '.autohand'));
    await writeFile(path.join(outside, 'identity'), '{"version":1,"id":"b944b77e-f809-4dcc-aac5-8ec2ec3353b0"}');
    await symlink(path.join(outside, 'identity'), path.join(root, '.autohand/workspace-identity.json'));
    await expect(readSkillWorkspaceIdentity(root)).rejects.toThrow('symlink');
    await expect(ensureSkillWorkspaceIdentity(root)).rejects.toThrow('symlink');
  });
});
