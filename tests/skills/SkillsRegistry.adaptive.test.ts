import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { formatSkillReference } from '../../src/skills/SkillRuntime.js';
import { computeSkillRevision, createSkillRevisionManifest } from '../../src/skills/SkillRevisionStore.js';
import type { LearnedSkillCandidate } from '../../src/skills/SkillLearningStore.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('adaptive registry catalog', () => {
  it('preserves qualified same-name packages while the nearest alias wins', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-registry-')); roots.push(root);
    const personal = path.join(root, 'home', '.autohand', 'skills');
    const project = path.join(root, 'project', '.autohand', 'skills');
    for (const directory of [personal, project]) {
      await mkdir(path.join(directory, 'review'), { recursive: true });
      await writeFile(path.join(directory, 'review', 'SKILL.md'), `---\nname: review\ndescription: Review code carefully\n---\n${directory === personal ? 'Personal procedure' : 'Project procedure'}`);
    }
    const registry = new SkillsRegistry(personal);
    await registry.initialize();
    await registry.setWorkspace(path.join(root, 'project'));
    await registry.ensureAdaptiveWorkspace();
    const runtime = registry.getSkillRuntime();
    const matches = runtime.search('review').filter(match => match.entry.name === 'review');
    expect(matches).toHaveLength(2);
    expect(registry.getSkill('review')?.body).toContain('Project procedure');
    const privateCopy = matches.find(match => match.entry.scope === 'personal')!;
    expect(privateCopy.entry.reference.authority).toBe('local:personal:autohand');
    const qualified = formatSkillReference(privateCopy.entry.reference);
    expect(registry.getSkill(qualified)?.body).toContain('Personal procedure');
    expect(registry.activateSkill(qualified)).toBe(true);
    expect(registry.getActiveSkills().some(skill => skill.body.includes('Personal procedure'))).toBe(true);
  });

  it('removes a previous workspace catalog and never creates identity during read-only resume binding', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-workspace-')); roots.push(root);
    const first = path.join(root, 'first'); const second = path.join(root, 'second');
    await mkdir(path.join(first, '.autohand/skills/private'), { recursive: true });
    await mkdir(second);
    await writeFile(path.join(first, '.autohand/skills/private/SKILL.md'), '---\nname: private\ndescription: Private first workspace\n---\nFirst only');
    const registry = new SkillsRegistry(path.join(root, 'personal'), 'autohand-user', { adaptiveEnabled: () => true });
    await registry.initialize(); await registry.setWorkspace(first);
    const previous = registry.getSkillReference(registry.getSkill('private')!);
    await registry.setWorkspace(second, { createIdentity: false });
    expect(registry.getSkill('private')).toBeNull();
    expect(registry.getSkillRuntime().resolve(previous)).toBeNull();
    const { access } = await import('node:fs/promises');
    await expect(access(path.join(second, '.autohand/workspace-identity.json'))).rejects.toThrow();
  });

  it('keeps learned drafts manual and scoped, retains source aliases, and removes revoked derivatives', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-learned-')); roots.push(root);
    const source = path.join(root, 'skills/review'); const candidateRoot = path.join(root, 'private-candidates/candidate');
    for (const directory of [source, candidateRoot]) await mkdir(directory, { recursive: true });
    const text = '---\nname: review\ndescription: Review code carefully\n---\nLearned procedure';
    await writeFile(path.join(source, 'SKILL.md'), text.replace('Learned', 'Original'));
    await writeFile(path.join(candidateRoot, 'SKILL.md'), text);
    const registry = new SkillsRegistry(path.join(root, 'skills'));
    await registry.initialize(); await registry.setWorkspace(root); await registry.ensureAdaptiveWorkspace();
    const parent = registry.getSkillReference(registry.getSkill('review')!);
    const candidate: LearnedSkillCandidate = { id: 'candidate', jobId: 'job', outcomeId: 'outcome', scope: 'user',
      reference: { authority: 'learned:user', packageId: 'candidate', revision: computeSkillRevision(createSkillRevisionManifest(new Map([['SKILL.md', Buffer.from(text)]]))) },
      parent: { ...parent, revision: 'sha256:' + 'a'.repeat(64) }, packagePath: candidateRoot, createdAt: new Date().toISOString(), status: 'draft' };
    await registry.setLearnedCandidates([candidate]);
    const ref = formatSkillReference(candidate.reference);
    expect(registry.getSkill('review')?.body).toContain('Original');
    expect(registry.getSkillRuntime().resolve(ref)).toMatchObject({ quality: 'draft', automatic: false });
    expect(registry.activateSkill(ref, 'agent')).toBe(false);
    expect(registry.activateSkill(ref, 'user')).toBe(true);
    await registry.setLearnedCandidates([{ ...candidate, status: 'verified' }]);
    expect(registry.getSkillRuntime().resolve(ref)).toMatchObject({ quality: 'verified', automatic: true, preference: 0 });
    await registry.setLearnedCandidates([{ ...candidate, scope: 'project:someone-else', status: 'preferred' }]);
    expect(registry.getSkillRuntime().resolve(ref)).toBeNull();
    await registry.setLearnedCandidates([{ ...candidate, status: 'quarantined' }]);
    expect(registry.getSkillRuntime().resolve(ref)).toBeNull();
  });
});
