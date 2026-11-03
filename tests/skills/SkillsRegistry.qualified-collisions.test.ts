import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionSkillContribution } from '../../src/extensions/types.js';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { formatSkillReference } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
const skillName = 'collision-review';

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function writeSkill(directory: string, body: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'SKILL.md');
  await writeFile(filename, `---\nname: ${skillName}\ndescription: Review collision behavior\n---\n${body}\n`);
  return filename;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qualified-skill-collisions-'));
  roots.push(root);
  const userSkills = path.join(root, 'skills');
  const builtinSkills = path.join(root, 'builtins');
  await writeSkill(path.join(userSkills, skillName), 'Personal review procedure.');
  await writeSkill(path.join(builtinSkills, skillName), 'Builtin review procedure.');
  const registry = new SkillsRegistry(userSkills, 'autohand-user', {
    builtinSkillDirectories: [builtinSkills],
    adaptiveEnabled: () => true,
  });
  await registry.initialize();
  return { root, registry };
}

async function accountSnapshot(root: string, enabled: boolean): Promise<void> {
  const token = 'collision-test-token';
  const accountId = 'collision-account';
  const configPath = path.join(root, 'config.json');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  await writeFile(configPath, JSON.stringify({ auth: { token }, api: { accountId } }));
  const cache = path.join(root, '.account-skills');
  await mkdir(cache, { recursive: true });
  if (enabled) await writeSkill(path.join(cache, hash(accountId), 'review-id'), 'Account review procedure.');
  await writeFile(path.join(cache, 'snapshot.json'), JSON.stringify({
    accountId, revision: 1, tokenHash: hash(token), requestedAccountId: accountId, configPath,
    skills: [{ id: 'review-id', name: skillName, description: 'Account review instructions',
      instructions: 'Account review procedure.', enabled, source: 'custom' }],
  }));
}

async function extension(root: string, extensionId: string): Promise<ExtensionSkillContribution> {
  const packageRoot = path.join(root, 'extensions', extensionId);
  const file = await writeSkill(path.join(packageRoot, 'skills', skillName), `${extensionId} procedure.`);
  return {
    definition: { name: skillName, description: 'Extension review instructions', body: `${extensionId} procedure.`,
      source: 'extension', path: file, isActive: false, metadata: { 'extension-id': 'forged.prose-authority' } },
    provenance: { extensionId, extensionVersion: '1.0.0', scope: 'user', packageRoot, file },
  };
}

describe('qualified skill collisions', () => {
  it('retains every local origin when an enabled account skill owns the unqualified alias', async () => {
    const { root, registry } = await fixture();
    const local = registry.getCatalogSkills().map(skill => ({ skill, reference: registry.getSkillReference(skill) }));
    await accountSnapshot(root, true);

    expect(registry.getSkill(skillName)?.body).toBe('Account review procedure.');
    expect(registry.getSkillRuntime().search(skillName).filter(match => match.entry.name === skillName)).toHaveLength(3);
    for (const { skill, reference } of local) {
      expect(registry.getSkill(formatSkillReference(reference))?.body).toBe(skill.body);
    }
  });

  it('preserves a disabled account alias while qualified independent packages remain available', async () => {
    const { root, registry } = await fixture();
    const local = registry.getCatalogSkills().map(skill => registry.getSkillReference(skill));
    await accountSnapshot(root, false);

    expect(registry.getSkill(skillName)).toBeNull();
    expect(registry.activateSkill(skillName)).toBe(false);
    for (const reference of local) {
      const qualified = formatSkillReference(reference);
      expect(registry.getSkill(qualified)).not.toBeNull();
      expect(registry.activateSkill(qualified)).toBe(true);
    }
    expect(registry.getSkillRuntime().search(skillName)).toHaveLength(2);
  });

  it('registers colliding extension packages without changing the local alias winner', async () => {
    const { root, registry } = await fixture();
    const contribution = await extension(root, 'autohand.review');
    registry.setExtensionSkills([contribution]);

    const extensions = registry.getSkillRuntime().list().filter(entry => entry.source === 'extension');
    expect(extensions).toHaveLength(1);
    expect(extensions[0].reference).toEqual({ authority: 'extension:autohand.review', packageId: `skills/${skillName}` });
    const qualified = formatSkillReference(extensions[0].reference);
    expect(registry.getSkill(qualified)?.body).toBe('autohand.review procedure.');
    expect(registry.getSkill(skillName)?.body).toContain('Personal review procedure.');
    expect(registry.activateSkill(qualified, 'agent')).toBe(true);
    expect(registry.getActiveSkills().filter(skill => skill.source === 'extension')).toHaveLength(1);
  });

  it('preserves activation ownership only for the same canonical extension during refresh', async () => {
    const { root, registry } = await fixture();
    const contribution = await extension(root, 'autohand.review');
    registry.setExtensionSkills([contribution]);
    const reference = { authority: 'extension:autohand.review', packageId: `skills/${skillName}` };
    expect(registry.activateSkill(formatSkillReference(reference), 'agent')).toBe(true);
    const original = registry.getSkill(formatSkillReference(reference));
    registry.setExtensionSkills([{ ...contribution, definition: { ...contribution.definition } }]);

    const refreshed = registry.getSkill(formatSkillReference(reference));
    expect(refreshed).not.toBe(original);
    expect(refreshed?.isActive).toBe(true);
    expect(refreshed && registry.getActivationOrigin(refreshed)).toBe('agent');

    registry.setExtensionSkills([await extension(root, 'autohand.other')]);
    expect(registry.getSkillRuntime().resolve(reference)).toBeNull();
    expect(registry.getActiveSkills().filter(skill => skill.source === 'extension')).toEqual([]);
  });

  it('removes revoked extension catalog records without exposing them through an unqualified fallback', async () => {
    const { root, registry } = await fixture();
    registry.setExtensionSkills([await extension(root, 'autohand.review')]);
    const reference = { authority: 'extension:autohand.review', packageId: `skills/${skillName}` };
    await accountSnapshot(root, false);

    expect(registry.getSkill(skillName)).toBeNull();
    expect(registry.getSkill(formatSkillReference(reference))).not.toBeNull();
    registry.setExtensionSkills([]);
    expect(registry.getSkillRuntime().resolve(reference)).toBeNull();
    expect(registry.getCatalogSkills().some(skill => skill.source === 'extension')).toBe(false);
    expect(registry.getSkill(skillName)).toBeNull();
  });
});
