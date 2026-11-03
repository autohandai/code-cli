import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillRuntime, formatSkillReference } from '../../src/skills/SkillRuntime.js';
import type { SkillCatalogEntry } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(authority = 'builtin', scope = 'builtin') {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-runtime-'));
  roots.push(root);
  await mkdir(path.join(root, 'references'));
  await writeFile(path.join(root, 'SKILL.md'), '---\nname: systematic-debugging\ndescription: Diagnose errors and fix bugs\n---\nKeep every constraint. Diagnose before editing.');
  await writeFile(path.join(root, 'references', 'checks.md'), 'Independently verify the result.');
  const entry: SkillCatalogEntry = { reference: { authority, packageId: 'systematic-debugging' }, name: 'systematic-debugging',
    description: 'Diagnose errors and fix bugs', source: authority, scope, root, enabled: true };
  return entry;
}

describe('canonical skill runtime', () => {
  it('searches authorized metadata, abstains on greetings, and keeps exact lookup independent of ranking', async () => {
    const debugging = await fixture();
    const hidden = { ...await fixture('team', 'other-member'), name: 'secret-debugging', description: 'Private error diagnosis' };
    const runtime = new SkillRuntime({ catalog: () => [debugging, hidden], authorizedScopes: () => new Set(['builtin']) });
    expect(runtime.search('hello')).toEqual([]);
    expect(runtime.search('diagnose this error').map(result => result.entry.name)).toEqual(['systematic-debugging']);
    expect(runtime.search('secret-debugging')).not.toContainEqual(expect.objectContaining({ entry: hidden }));
    expect(runtime.resolve(formatSkillReference(hidden.reference))).toBeNull();
    expect(runtime.resolve(formatSkillReference(debugging.reference))).toEqual(debugging);
  });

  it('keeps same-name authorities distinct and preserves nearest-root alias precedence', async () => {
    const near = await fixture('project', 'project');
    const other = await fixture('personal', 'personal');
    const runtime = new SkillRuntime({ catalog: () => [near, other], authorizedScopes: () => new Set(['project', 'personal']) });
    expect(runtime.resolve('systematic-debugging')).toEqual(near);
    expect(runtime.resolve(formatSkillReference(other.reference))).toEqual(other);
    expect(runtime.search('systematic-debugging')).toHaveLength(2);
  });

  it('pins the entire package, preserves full instructions, and survives a locator move', async () => {
    const entry = await fixture();
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => new Set(['builtin']) });
    const packet = await runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 });
    expect(packet.content).toContain(await readFile(path.join(entry.root, 'SKILL.md'), 'utf8'));
    expect(packet.manifest.map(resource => resource.path)).toEqual(['SKILL.md', 'references/checks.md']);
    const moved = await fixture();
    entry.root = moved.root;
    expect((await runtime.prepare(packet.reference, { taskId: 'task', reason: 'restored', maxTokens: 1_000 })).reference.revision).toBe(packet.reference.revision);
    await writeFile(path.join(entry.root, 'references', 'checks.md'), 'Changed checks.');
    await expect(runtime.prepare(packet.reference, { taskId: 'task', reason: 'restored', maxTokens: 1_000 })).rejects.toThrow(/revision/i);
  });

  it('reports oversize instructions and escaping resources instead of truncating them', async () => {
    const entry = await fixture();
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => new Set(['builtin']) });
    await expect(runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1 })).rejects.toThrow(/budget/i);
    const outside = await fixture('outside');
    await symlink(path.join(outside.root, 'SKILL.md'), path.join(entry.root, 'escape.md'));
    await expect(runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 })).rejects.toThrow(/outside|escape|contain/i);
  });

  it('requires request content and rechecks authorization and revision before a loading receipt', async () => {
    const entry = await fixture();
    const scopes = new Set(['builtin']);
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => scopes });
    const packet = await runtime.prepare(entry.reference, { taskId: 'task', reason: 'local', maxTokens: 1_000 });
    expect(runtime.receipts()).toEqual([]);
    await expect(runtime.acknowledgeDispatch([packet], { taskId: 'task', requestId: 'r0', sessionId: 's', adapter: 'autohand', content: ['hello'], policyEpoch: 0 })).rejects.toThrow(/content|packet/i);
    const dispatch = { taskId: 'task', requestId: 'r1', sessionId: 's', adapter: 'autohand' as const, content: [packet.content], policyEpoch: 0 };
    await runtime.acknowledgeDispatch([packet], dispatch);
    await runtime.acknowledgeDispatch([packet], dispatch);
    expect(runtime.receipts()).toHaveLength(1);
    expect(runtime.receipts()[0]).toMatchObject({ state: 'submitted', requestId: 'r1', reference: packet.reference });
    scopes.clear();
    await expect(runtime.acknowledgeDispatch([packet], { ...dispatch, requestId: 'r2' })).rejects.toThrow(/authorized|unavailable/i);
    scopes.add('builtin');
    await writeFile(path.join(entry.root, 'references', 'checks.md'), 'Changed after preparation.');
    await expect(runtime.acknowledgeDispatch([packet], { ...dispatch, requestId: 'r3' })).rejects.toThrow(/revision/i);
    expect(runtime.receipts()).toHaveLength(1);
  });

  it('reports external handoffs as supplied rather than confirmed loading', async () => {
    const entry = await fixture();
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => new Set(['builtin']) });
    const packet = await runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 });
    await runtime.acknowledgeDispatch([packet], { taskId: 'task', requestId: 'r', sessionId: 's', adapter: 'external', content: [packet.content], policyEpoch: 0 });
    expect(runtime.receipts()[0]).toMatchObject({ state: 'supplied', capability: 'external-handoff' });
  });

  it('rejects modified packets even when a caller preserves the old digest', async () => {
    const entry = await fixture();
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => new Set(['builtin']) });
    const packet = await runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 });
    const modified = { ...packet, content: 'hello' };
    await expect(runtime.acknowledgeDispatch([modified], { taskId: 'task', requestId: 'r', sessionId: 's', adapter: 'autohand', content: ['hello'], policyEpoch: 0 })).rejects.toThrow(/digest|modified|integrity/i);
    expect(runtime.receipts()).toEqual([]);
  });

  it('retains an explicitly requested resource in the pin and rejects dependency cycles', async () => {
    const entry = await fixture();
    const runtime = new SkillRuntime({ catalog: () => [entry], authorizedScopes: () => new Set(['builtin']) });
    const packet = await runtime.prepare({ ...entry.reference, resource: 'references/checks.md' }, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 });
    expect(packet.reference.resource).toBe('references/checks.md');
    await runtime.acknowledgeDispatch([packet], { taskId: 'task', requestId: 'r', sessionId: 's', adapter: 'autohand', content: [packet.content], policyEpoch: 0 });
    entry.dependencies = [entry.reference];
    await expect(runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 1_000 })).rejects.toThrow(/cycle/i);
  });

  it('loads declared required resources and exact dependencies and rejects invalid declarations', async () => {
    const entry = await fixture(); const dependency = await fixture('dependent');
    const runtime = new SkillRuntime({ catalog: () => [entry, dependency], authorizedScopes: () => new Set(['builtin']) });
    const pinned = (await runtime.prepare(dependency.reference, { taskId: 'task', reason: 'explicit', maxTokens: 2_000 })).reference;
    await writeFile(path.join(entry.root, 'skill.runtime.json'), JSON.stringify({ version: 1, requiredResources: ['references/checks.md'], dependencies: [pinned] }));
    const packet = await runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 2_000 });
    expect(packet.content).toContain('Independently verify the result.');
    expect(packet.dependencies[0].reference).toEqual(pinned);
    expect(packet.resourcePaths).not.toContain('skill.runtime.json');
    await writeFile(path.join(entry.root, 'skill.runtime.json'), JSON.stringify({ version: 1, requiredResources: ['../outside'] }));
    await expect(runtime.prepare(entry.reference, { taskId: 'task', reason: 'explicit', maxTokens: 2_000 })).rejects.toThrow(/declaration|resource/i);
  });
});
