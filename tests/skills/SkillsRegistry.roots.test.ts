import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { formatSkillReference } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('distinguishes project ecosystems and explicit custom-library authorities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-library-roots-')); roots.push(root);
  const locations = [path.join(root, 'a/skills'), path.join(root, 'b/skills')].map((basePath, index) => ({
    basePath, source: 'autohand-user' as const, recursive: true, authority: `local:library:stable-${index}`,
  }));
  for (const directory of [...locations.map(item => item.basePath), path.join(root, '.pi/skills'), path.join(root, '.agents/skills'), path.join(root, '.codex/skills')]) {
    await mkdir(path.join(directory, 'review'), { recursive: true });
    await writeFile(path.join(directory, 'review/SKILL.md'), `---\nname: review\ndescription: Review code\n---\n${directory}`);
  }
  const registry = new SkillsRegistry(path.join(root, 'personal'), 'autohand-user', { userSkillLocations: locations });
  await registry.initialize(); await registry.setWorkspace(root); await registry.ensureAdaptiveWorkspace();
  const refs = registry.getCatalogSkills().filter(item => item.name === 'review').map(skill => registry.getSkillReference(skill));
  expect(refs).toHaveLength(5);
  expect(new Set(refs.map(formatSkillReference)).size).toBe(5);
  for (const reference of refs) expect(registry.getSkillRuntime().resolve(reference)).not.toBeNull();
  expect(refs.map(ref => ref.authority)).toContain('local:library:stable-0');
  expect(refs.map(ref => ref.authority)).toContain('local:library:stable-1');
});
