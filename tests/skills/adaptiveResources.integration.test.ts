import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { prepareSkillRequest } from '../../src/core/agent/SkillRequestAttachment.js';
import type { AgentOutputEvent, MultimodalMessage } from '../../src/types.js';
import type { SkillAttachmentReceipt } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-resources-integration-'));
  roots.push(root);
  const skills = path.join(root, '.autohand', 'skills');
  const parent = path.join(skills, 'portable-parent');
  const child = path.join(skills, 'portable-checks');
  for (const directory of [parent, child]) {
    await mkdir(path.join(directory, 'scripts'), { recursive: true });
    await mkdir(path.join(directory, 'references'));
  }
  await writeFile(path.join(parent, 'SKILL.md'), '---\nname: portable-parent\ndescription: Portable integration procedure\n---\nRun scripts/check.sh from this pinned package. Preserve every declared requirement.');
  await writeFile(path.join(child, 'SKILL.md'), '---\nname: portable-checks\ndescription: Independent portable checks\n---\nRun scripts/verify.sh from this pinned dependency. Never weaken the independent acceptance checks.');
  const parentScript = '#!/bin/sh\nprintf "PINNED_PARENT_V1\\n"\n';
  const childScript = '#!/bin/sh\nprintf "PINNED_DEPENDENCY_V1\\n"\n';
  const required = 'REQUIRED_CONSTRAINT_BEGIN\nCheck permissions before changing files. Preserve all acceptance checks.\nREQUIRED_CONSTRAINT_END';
  await writeFile(path.join(parent, 'scripts/check.sh'), parentScript);
  await writeFile(path.join(parent, 'scripts/data.bin'), new Uint8Array([0, 255, 128, 0, 1]));
  await writeFile(path.join(child, 'scripts/verify.sh'), childScript);
  await writeFile(path.join(parent, 'references/requirements.md'), required);
  const registry = new SkillsRegistry(skills);
  await registry.initialize();
  const childDefinition = registry.getSkill('portable-checks')!;
  const childPacket = await registry.getSkillRuntime().prepare(registry.getSkillReference(childDefinition), { taskId: 'archive-child', reason: 'explicit', maxTokens: 5_000 });
  await writeFile(path.join(parent, 'skill.runtime.json'), JSON.stringify({ version: 1, requiredResources: ['references/requirements.md'], dependencies: [childPacket.reference] }));
  const events: AgentOutputEvent[] = [];
  const persisted: SkillAttachmentReceipt[] = [];
  const persistent = { metadata: { sessionId: 'integration-session' }, append: async (message: { _meta: { skillReceipt: SkillAttachmentReceipt } }) => { persisted.push(message._meta.skillReceipt); } };
  const host = { config: { features: { adaptiveSkills: true } }, skillsRegistry: registry,
    sessionManager: { getCurrentSession: () => persistent }, emitOutput: (event: AgentOutputEvent) => { events.push(event); } };
  const messages: MultimodalMessage[] = [{ role: 'system', content: 'Stable system policy.' }, { role: 'user', content: '$portable-parent' }];
  await registry.getAdaptiveSession().beginTask('$portable-parent', { taskId: 'integration-task' });
  return { root, parent, child, registry, host, events, persisted, messages, parentScript, childScript, required };
}

describe('production adaptive resource and request contract', () => {
  it('attaches full declared requirements and exact dependencies through the real registry and request helper', async () => {
    const { registry, host, events, persisted, messages, required, parentScript, childScript } = await fixture();
    const request = await prepareSkillRequest(host, messages, 5_000);
    const body = request.messages.map(message => String(message.content)).join('\n');
    const [packet] = await registry.getAdaptiveSession().prepareRequest({ maxTokens: 5_000 });
    expect(body).toContain(required);
    expect(body).toContain('Never weaken the independent acceptance checks.');
    expect(body).toContain(packet.resourceRoot!);
    expect(body).toContain(packet.dependencies[0].resourceRoot!);
    expect(packet.dependencies[0].reference.packageId).toBe('portable-checks');
    expect(await readFile(path.join(packet.resourceRoot!, 'scripts/check.sh'), 'utf8')).toBe(parentScript);
    expect(await readFile(path.join(packet.dependencies[0].resourceRoot!, 'scripts/verify.sh'), 'utf8')).toBe(childScript);
    expect(events).toEqual([]);
    await request.acknowledge();
    expect(persisted).toHaveLength(2);
    expect(persisted.every(receipt => receipt.state === 'submitted' && receipt.scope === 'personal')).toBe(true);
    expect(persisted.find(receipt => receipt.reference.packageId === 'portable-parent')?.resources.map(resource => resource.path)).toEqual(['SKILL.md', 'references/requirements.md']);
    const rebuilt = await prepareSkillRequest(host, messages, 5_000);
    await rebuilt.acknowledge();
    expect(persisted).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(registry.getSkillRuntime().receipts()).toHaveLength(4);
  });

  it('restores the exact physical parent and dependency scripts after both live packages change', async () => {
    const { registry, host, messages, parent, child, parentScript, childScript, required } = await fixture();
    const firstRequest = await prepareSkillRequest(host, messages, 5_000);
    await firstRequest.acknowledge();
    const [first] = await registry.getAdaptiveSession().prepareRequest({ maxTokens: 5_000 });
    await writeFile(path.join(parent, 'scripts/check.sh'), '#!/bin/sh\nprintf "CHANGED_PARENT\\n"\n');
    await writeFile(path.join(child, 'scripts/verify.sh'), '#!/bin/sh\nprintf "CHANGED_DEPENDENCY\\n"\n');
    await writeFile(path.join(parent, 'references/requirements.md'), 'Changed live requirements.');
    registry.deactivateAll();
    registry.getAdaptiveSession().restorePins([first.reference]);
    await registry.getAdaptiveSession().beginTask('Resume approved procedure.', { taskId: 'restored-integration-task' });
    const restoredRequest = await prepareSkillRequest(host, messages, 5_000);
    const [restored] = await registry.getAdaptiveSession().prepareRequest({ maxTokens: 5_000 });
    expect(restored.resourceRoot).toBe(first.resourceRoot);
    expect(restored.dependencies[0].resourceRoot).toBe(first.dependencies[0].resourceRoot);
    expect(await readFile(path.join(restored.resourceRoot!, 'scripts/check.sh'), 'utf8')).toBe(parentScript);
    expect(await readFile(path.join(restored.dependencies[0].resourceRoot!, 'scripts/verify.sh'), 'utf8')).toBe(childScript);
    expect(new Uint8Array(await readFile(path.join(restored.resourceRoot!, 'scripts/data.bin')))).toEqual(new Uint8Array([0, 255, 128, 0, 1]));
    expect(restoredRequest.messages.map(message => String(message.content)).join('\n')).toContain(required);
    await restoredRequest.acknowledge();
  });

  it('rejects edited materialized scripts before a cached request can be dispatched and preserves the user edit', async () => {
    const { registry, host, messages, persisted } = await fixture();
    const first = await prepareSkillRequest(host, messages, 5_000);
    await first.acknowledge();
    const [packet] = await registry.getAdaptiveSession().prepareRequest({ maxTokens: 5_000 });
    const script = path.join(packet.resourceRoot!, 'scripts/check.sh');
    await writeFile(script, '#!/bin/sh\nUSER_EDIT=1\n');
    await expect(prepareSkillRequest(host, messages, 5_000)).rejects.toThrow(/corrupt|digest|bytes|resource/i);
    expect(await readFile(script, 'utf8')).toBe('#!/bin/sh\nUSER_EDIT=1\n');
    expect(persisted).toHaveLength(2);
  });

  it('fails a required-instruction budget decision visibly without truncation or attachment receipts', async () => {
    const { host, messages, events, persisted } = await fixture();
    await expect(prepareSkillRequest(host, messages, 1)).rejects.toThrow(/budget|tokens|truncat/i);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });
});
