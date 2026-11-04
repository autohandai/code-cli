import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SkillSnapshotCatalog } from '../../src/skills/SkillSnapshotCatalog.js';
import { readSkillPackage } from '../../src/skills/SkillRuntime.js';
import { createSkillRevisionManifest, computeSkillRevision } from '../../src/skills/SkillRevisionStore.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'skill-snapshot-catalog-')));
  roots.push(root);
  const skills = path.join(root, 'alice', 'skills');
  await mkdir(skills, { recursive: true });
  const filename = path.join(skills, 'installed-skills.json');
  const write = async (installed: unknown[], other: Record<string, unknown> = {}) => writeFile(filename, JSON.stringify({ version: 1, installed, ...other }), { mode: 0o600 });
  const packageFor = async (folder: string, authority = 'local:personal:agents', scope = 'member') => {
    const dir = path.join(skills, folder);
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), '---\nname: review\n---\nRequired instructions.');
    await writeFile(path.join(dir, 'scripts', 'verify.sh'), 'echo verify');
    const resources = createSkillRevisionManifest(await readSkillPackage(dir));
    const revision = computeSkillRevision(resources);
    return { id: folder, dir, path: path.join(dir, 'SKILL.md'), reference: { authority, packageId: 'review', revision, resource: 'SKILL.md' }, manifest: { version: 1, revision, resources }, scope, ownerId: 'alice' };
  };
  return { root, skills, filename, write, packageFor };
}

describe('host-managed member skill snapshots', () => {
  it('leaves an ordinary library unmanaged until a host manifest exists', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.managed).toBe(false);
    expect(catalog.isEnrolled(entry.path)).toBe(false);
    expect(catalog.referenceFor(entry.path)).toBeNull();
  });

  it('keeps a freshly marked member managed when its manifest is missing', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    const catalog = new SkillSnapshotCatalog(f.skills, { managed: true });
    await catalog.refresh();
    expect(catalog.managed).toBe(true);
    expect(catalog.referenceFor(entry.path)).toBeNull();
    expect(catalog.authorizedScopes(randomUUID()).size).toBe(0);
  });

  it('preserves exact origin, package, resources and private scope from installed rows only', async () => {
    const f = await fixture();
    const installed = await f.packageFor('review');
    const retained = await f.packageFor('retained', 'local:personal:claude');
    const failed = await f.packageFor('failed', 'registry:fixture/repo');
    await f.write([installed], { retained: [retained], failed: [failed] });
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.managed).toBe(true);
    expect(catalog.referenceFor(installed.path)).toEqual(installed.reference);
    expect(catalog.scopeFor(installed.path)).toBe('member:alice');
    expect([...catalog.authorizedScopes(randomUUID())]).toEqual(['member:alice']);
    expect(catalog.isEnrolled(retained.path)).toBe(false);
    expect(catalog.isEnrolled(failed.path)).toBe(false);
    const copy = catalog.referenceFor(installed.path)!;
    copy.authority = 'mutated';
    expect(catalog.referenceFor(installed.path)?.authority).toBe(installed.reference.authority);
  });

  it('keeps same-name authorities distinct and filters project authorization by stable workspace identity', async () => {
    const f = await fixture();
    const workspaceId = randomUUID();
    const otherWorkspace = randomUUID();
    const local = await f.packageFor('personal');
    const project = await f.packageFor('project', `local:workspace:${workspaceId}:agents`, 'project');
    const other = await f.packageFor('other', `local:workspace:${otherWorkspace}:agents`, 'project');
    const team = await f.packageFor('team', 'local:squad', 'team');
    await f.write([local, project, other, team]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.referenceFor(local.path)?.authority).not.toBe(catalog.referenceFor(project.path)?.authority);
    expect(catalog.scopeFor(project.path)).toBe(`project:${workspaceId}`);
    expect(catalog.authorizedScopes(workspaceId)).toEqual(new Set(['member:alice', `project:${workspaceId}`, 'team']));
    expect(catalog.authorizedScopes(workspaceId).has(`project:${otherWorkspace}`)).toBe(false);
  });

  it('preserves nested project ecosystems without collapsing their authority', async () => {
    const f = await fixture();
    const workspaceId = randomUUID();
    const entry = await f.packageFor('nested', `local:workspace:${workspaceId}:tabnine/agent`, 'project');
    await f.write([entry]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.referenceFor(entry.path)).toEqual(entry.reference);
    expect(catalog.scopeFor(entry.path)).toBe(`project:${workspaceId}`);
    expect(catalog.authorizedScopes(randomUUID()).size).toBe(0);
  });

  it('revokes tampered packages without silently repinning and accepts an explicit exact replacement', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    await f.write([entry]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    await writeFile(path.join(entry.dir, 'scripts', 'verify.sh'), 'changed helper');
    await catalog.refresh();
    expect(catalog.managed).toBe(true);
    expect(catalog.referenceFor(entry.path)).toBeNull();
    const resources = createSkillRevisionManifest(await readSkillPackage(entry.dir));
    const revision = computeSkillRevision(resources);
    await f.write([{ ...entry, reference: { ...entry.reference, revision }, manifest: { version: 1, revision, resources } }]);
    await catalog.refresh();
    expect(catalog.referenceFor(entry.path)?.revision).toBe(revision);
    expect(await readFile(path.join(entry.dir, 'scripts', 'verify.sh'), 'utf8')).toBe('changed helper');
  });

  it('rejects outside paths, symlink resources, mismatched owners and package-prose scope grants', async () => {
    const f = await fixture();
    const outside = await f.packageFor('outside');
    const externalDir = path.join(f.root, 'external');
    await rename(outside.dir, externalDir);
    const linked = await f.packageFor('linked');
    await symlink(path.join(linked.dir, 'SKILL.md'), path.join(linked.dir, 'link.md'));
    const wrongOwner = await f.packageFor('wrong-owner');
    const wrongScope = await f.packageFor('wrong-scope');
    await f.write([{ ...outside, dir: externalDir, path: path.join(externalDir, 'SKILL.md') }, linked, { ...wrongOwner, ownerId: 'bob' }, { ...wrongScope, scope: 'builtin' }]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.managed).toBe(true);
    for (const item of [outside, linked, wrongOwner, wrongScope]) expect(catalog.isEnrolled(item.path)).toBe(false);
    expect(catalog.authorizedScopes(randomUUID()).size).toBe(0);
  });

  it('fails closed on malformed host metadata and after an enrolled manifest disappears', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    await f.write([entry]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    await writeFile(f.filename, '{invalid');
    await expect(catalog.refresh()).rejects.toThrow(/manifest|metadata/i);
    expect(catalog.managed).toBe(true);
    expect(catalog.isEnrolled(entry.path)).toBe(false);
    await rename(f.filename, path.join(f.root, 'retained-invalid.json'));
    await catalog.refresh();
    expect(catalog.managed).toBe(true);
    expect(catalog.authorizedScopes(randomUUID()).size).toBe(0);
  });

  it('rejects a symlinked host manifest before reading its rows', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    const external = path.join(f.root, 'external-manifest.json');
    await writeFile(external, JSON.stringify({ version: 1, installed: [entry] }));
    await symlink(external, f.filename);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await expect(catalog.refresh()).rejects.toThrow(/manifest|metadata|symbolic/i);
    expect(catalog.managed).toBe(true);
    expect(catalog.referenceFor(entry.path)).toBeNull();
  });

  it('rejects conflicting origins for one canonical snapshot through different path aliases', async () => {
    const f = await fixture();
    const entry = await f.packageFor('review');
    const aliasRoot = `${f.root}-alias`;
    roots.push(aliasRoot);
    await symlink(f.root, aliasRoot, 'dir');
    const alias = { ...entry, dir: path.join(aliasRoot, 'alice', 'skills', 'review'), path: path.join(aliasRoot, 'alice', 'skills', 'review', 'SKILL.md') };
    await f.write([alias, { ...entry, reference: { ...entry.reference, authority: 'registry:conflicting-origin' } }]);
    const catalog = new SkillSnapshotCatalog(f.skills);
    await catalog.refresh();
    expect(catalog.isEnrolled(alias.path)).toBe(false);
    expect(catalog.isEnrolled(entry.path)).toBe(false);
  });
});
