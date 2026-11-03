import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillsRegistry } from '../../../src/skills/SkillsRegistry.js';
import { prepareSkillRequest } from '../../../src/core/agent/SkillRequestAttachment.js';
import type { AgentOutputEvent, MultimodalMessage } from '../../../src/types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(instruction: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-request-')); roots.push(root);
  await mkdir(path.join(root, 'receipt-skill'));
  const filename = path.join(root, 'receipt-skill', 'SKILL.md');
  await writeFile(filename, '---\nname: receipt-skill\ndescription: A request receipt fixture\n---\nKeep the full required instructions.');
  const registry = new SkillsRegistry(root);
  await registry.initialize();
  await registry.getAdaptiveSession().beginTask(instruction, { taskId: 'task' });
  const append = vi.fn().mockResolvedValue(undefined);
  const session = { metadata: { sessionId: 'session' }, append };
  const events: AgentOutputEvent[] = [];
  const host = { config: { features: { adaptiveSkills: true } }, skillsRegistry: registry,
    sessionManager: { getCurrentSession: () => session }, emitOutput: (event: AgentOutputEvent) => events.push(event) };
  return { host, registry, events, append, filename };
}

describe('request-bound skill attachments', () => {
  it('adds no packet or receipt for a greeting', async () => {
    const { host, events, append } = await fixture('hello');
    const messages: MultimodalMessage[] = [{ role: 'system', content: 'Stable leading policy' }, { role: 'user', content: 'hello' }];
    const prepared = await prepareSkillRequest(host, messages, 1_000);
    expect(prepared.messages).toEqual(messages);
    await prepared.acknowledge();
    expect(events).toEqual([]);
    expect(append).not.toHaveBeenCalled();
  });

  it('attaches once after stable policy, then persists and emits only an accepted request', async () => {
    const { host, events, append } = await fixture('$receipt-skill');
    const prepared = await prepareSkillRequest(host, [{ role: 'system', content: 'Stable leading policy' }, { role: 'user', content: '$receipt-skill' }], 1_000);
    expect(prepared.messages[0].content).toBe('Stable leading policy');
    expect(prepared.messages.filter(message => String(message.content).includes('Keep the full required instructions.'))).toHaveLength(1);
    expect(events).toHaveLength(0);
    await prepared.acknowledge();
    await prepared.acknowledge();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'skill_attachment', receipt: { state: 'submitted', capability: 'provider-request', sessionId: 'session' } });
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0][0]._meta.skillReceipt).toEqual(events[0].receipt);
  });

  it('rejects a package changed before acknowledgment without a false loading event', async () => {
    const { host, events, append, filename } = await fixture('$receipt-skill');
    const prepared = await prepareSkillRequest(host, [{ role: 'system', content: 'Policy' }, { role: 'user', content: '$receipt-skill' }], 1_000);
    await writeFile(filename, 'Changed while the request was being prepared.');
    await expect(prepared.acknowledge()).rejects.toThrow(/revision/i);
    expect(events).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  it('validates goal pins before dispatch and refuses stale policy receipts', async () => {
    const { host, events } = await fixture('$receipt-skill');
    let epoch = 4;
    const assertTaskPins = vi.fn().mockResolvedValue(undefined);
    const prepared = await prepareSkillRequest({ ...host, getPolicyEpoch: () => epoch, assertTaskPins }, [{ role: 'user', content: '$receipt-skill' }], 1_000);
    expect(assertTaskPins).toHaveBeenCalledWith([expect.objectContaining({ revision: expect.stringMatching(/^sha256:/) })]);
    epoch++;
    await expect(prepared.acknowledge()).rejects.toThrow(/policy/);
    expect(events).toEqual([]);
    assertTaskPins.mockRejectedValueOnce(new Error('Goal revision requires explicit upgrade'));
    await expect(prepareSkillRequest({ ...host, assertTaskPins }, [{ role: 'user', content: '$receipt-skill' }], 1_000)).rejects.toThrow(/upgrade/);
  });

  it('still validates active goal pins when adaptive skills are disabled', async () => {
    const { host } = await fixture('$receipt-skill');
    const assertTaskPins = vi.fn().mockRejectedValue(new Error('Required goal packets are missing'));
    await expect(prepareSkillRequest({ ...host, config: {}, assertTaskPins }, [{ role: 'user', content: 'continue' }], 1_000)).rejects.toThrow(/missing/);
    expect(assertTaskPins).toHaveBeenCalledWith([]);
  });
});
