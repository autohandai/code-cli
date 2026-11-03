import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { readSkillPackage, formatSkillReference } from '../../src/skills/SkillRuntime.js';
import { computeSkillRevision, createSkillRevisionManifest } from '../../src/skills/SkillRevisionStore.js';
import { prepareSkillRequest } from '../../src/core/agent/SkillRequestAttachment.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'registry-snapshot-'))); roots.push(root);
  const skills = path.join(root, 'alice/skills'); const workspace = path.join(root, 'workspace');
  const writeSkill = async (directory: string, name: string) => {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} fixture guidance\n---\nKeep complete ${name} guidance`);
  };
  await mkdir(workspace);
  await writeSkill(path.join(skills, 'selected'), 'selected');
  await writeSkill(path.join(skills, 'retained'), 'retained');
  await writeSkill(path.join(root, 'home/.codex/skills/personal-secret'), 'personal-secret');
  await writeSkill(path.join(workspace, '.autohand/skills/project-secret'), 'project-secret');
  const resources = createSkillRevisionManifest(await readSkillPackage(path.join(skills, 'selected')));
  const reference = { authority: 'registry:fixture', packageId: 'portable-selected', revision: computeSkillRevision(resources), resource: 'SKILL.md' };
  const manifest = path.join(skills, 'installed-skills.json');
  await writeFile(manifest, JSON.stringify({ version: 1, installed: [{ ownerId: 'alice', scope: 'member',
    dir: path.join(skills, 'selected'), path: path.join(skills, 'selected/SKILL.md'), reference,
    manifest: { version: 1, revision: reference.revision, resources } }] }), { mode: 0o600 });
  const registry = new SkillsRegistry(skills, 'autohand-user', { includeDefaultUserSkillLocations: true, homeDir: path.join(root, 'home'), adaptiveEnabled: () => true });
  await registry.initialize(); await registry.setWorkspace(workspace);
  return { registry, manifest, reference };
}

describe('installed member catalog integration', () => {
  it('preserves exact enrolled identity and excludes unrelated home, project and retained packages', async () => {
    const { registry, reference } = await fixture();
    expect(registry.getSkill('personal-secret')).toBeNull();
    expect(registry.getSkill('project-secret')).toBeNull();
    expect(registry.getSkill('retained')).toBeNull();
    expect(registry.getSkillReference(registry.getSkill('selected')!)).toEqual(reference);
    expect(registry.getSkillRuntime().resolve(reference)?.scope).toBe('member:alice');
    await registry.getAdaptiveSession().beginTask(`$${formatSkillReference(reference)}`, { taskId: 'task' });
    expect((await registry.getAdaptiveSession().prepareRequest({ maxTokens: 2_000 }))[0].reference).toEqual(reference);
  });

  it('does not dispatch explicitly required context after host enrollment is revoked', async () => {
    const { registry, manifest, reference } = await fixture();
    await registry.getAdaptiveSession().beginTask(`$${formatSkillReference(reference)}`, { taskId: 'task' });
    await writeFile(manifest, JSON.stringify({ version: 1, installed: [] }), { mode: 0o600 });
    await expect(prepareSkillRequest({ config: { features: { adaptiveSkills: true } }, skillsRegistry: registry,
      sessionManager: { getCurrentSession: () => null }, emitOutput: () => {} }, [{ role: 'user', content: 'work' }], 2_000)).rejects.toThrow(/authorized|unavailable|selected|pinned/i);
    expect(registry.getSkillRuntime().receipts()).toEqual([]);
  });
});
