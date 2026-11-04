import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveSkillSession } from '../../src/skills/AdaptiveSkillSession.js';
import { SkillRuntime, formatSkillReference, parseSkillReference } from '../../src/skills/SkillRuntime.js';
import { SkillRevisionStore } from '../../src/skills/SkillRevisionStore.js';
import type { SkillDefinition } from '../../src/skills/types.js';
import type { SkillCatalogEntry, SkillReference } from '../../src/skills/SkillRuntime.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(skills: Array<{ name: string; description?: string; authority?: string }> = [{ name: 'review', description: 'Review code carefully' }]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-session-'));
  roots.push(root);
  const definitions: SkillDefinition[] = [];
  const entries: SkillCatalogEntry[] = [];
  for (const [index, skill] of skills.entries()) {
    const directory = path.join(root, String(index));
    await mkdir(directory);
    const body = `Keep ${skill.name} constraints intact. Independently verify every required check.`;
    await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${skill.description ?? skill.name}\n---\n${body}`);
    const reference = { authority: skill.authority ?? 'builtin', packageId: skill.name };
    definitions.push({ ...skill, description: skill.description ?? skill.name, source: 'builtin', path: path.join(directory, 'SKILL.md'), body, isActive: false, reference });
    entries.push({ name: skill.name, description: skill.description ?? skill.name, source: 'builtin', scope: 'builtin', reference, root: directory, enabled: true });
  }
  const origins = new WeakMap<SkillDefinition, 'user' | 'agent'>();
  const activationReferences = new WeakMap<SkillDefinition, SkillReference>();
  const runtime = new SkillRuntime({ catalog: () => entries, authorizedScopes: () => new Set(['builtin']),
    revisionStore: new SkillRevisionStore(path.join(root, 'archives')) });
  const registry = {
    getSkillRuntime: () => runtime,
    getCatalogSkills: () => definitions,
    getSkillReference: (skill: SkillDefinition) => skill.reference!,
    getActivationOrigin: (skill: SkillDefinition) => origins.get(skill),
    getActivationReference: (skill: SkillDefinition) => activationReferences.get(skill) ?? skill.reference!,
    ensureAdaptiveWorkspace: vi.fn(async () => {}),
    activateSkill: vi.fn((name: string, origin: 'user' | 'agent' = 'user') => {
      const reference = parseSkillReference(name);
      const skill = definitions.find(candidate => reference
        ? candidate.reference!.authority === reference.authority && candidate.reference!.packageId === reference.packageId
        : candidate.name === name);
      if (!skill) return false;
      skill.isActive = true;
      origins.set(skill, origin);
      activationReferences.set(skill, reference ?? skill.reference!);
      return true;
    }),
  };
  return { root, definitions, entries, runtime, registry, session: new AdaptiveSkillSession({ registry }) };
}

function observation(content: string[], requestId = 'request') {
  return { requestId, sessionId: 'session', content, policyEpoch: 1 };
}

describe('adaptive skill session', () => {
  it('abstains on greetings without preparing files or consulting optional reranking', async () => {
    const { registry, runtime } = await fixture();
    const rerank = vi.fn();
    const session = new AdaptiveSkillSession({ registry, rerank });
    const prepare = vi.spyOn(runtime, 'prepare');
    await session.beginTask('hello');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(session.getPinnedReferences()).toEqual([]);
  });

  it('selects explicit aliases once, preserves full instructions, and bypasses ranking', async () => {
    const { registry, runtime, definitions } = await fixture();
    const rerank = vi.fn();
    const search = vi.spyOn(runtime, 'search');
    const session = new AdaptiveSkillSession({ registry, rerank });
    await session.beginTask('Use $review and $review for this change.', { taskId: 'task' });
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ taskId: 'task', reason: 'explicit' });
    expect(packets[0].content).toContain(definitions[0].body);
    expect(search).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(registry.activateSkill).toHaveBeenCalledTimes(1);
  });

  it('preserves bare mode by skipping intent, lexical, and rerank selection while retaining explicit user skills', async () => {
    const { registry, runtime } = await fixture([{ name: 'brainstorm' }, { name: 'review', description: 'Review code carefully' }]);
    const rerank = vi.fn();
    const search = vi.spyOn(runtime, 'search');
    const session = new AdaptiveSkillSession({ registry, rerank });
    await session.beginTask('review code; brainstorm the design', { automatic: false, planModeActive: true });
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    await session.beginTask('$review', { automatic: false });
    expect((await session.prepareRequest({ maxTokens: 1_000 })).map(packet => packet.name)).toEqual(['review']);
    await session.beginTask('Continue', { automatic: false });
    expect((await session.prepareRequest({ maxTokens: 1_000 })).map(packet => packet.name)).toEqual(['review']);
  });

  it('does not carry an automatic active selection into a subsequent bare task', async () => {
    const { session } = await fixture();
    await session.beginTask('review code');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toHaveLength(1);
    await session.beginTask('Continue', { automatic: false });
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('abstains on a greeting after an earlier task implicitly selected a skill', async () => {
    const { session } = await fixture();
    await session.beginTask('review code');
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    await session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content)));
    await session.beginTask('hello');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    expect(session.getPinnedReferences()).toEqual([]);
  });

  it('treats a preferred catalog package with a revision as a local selection rather than a restored goal', async () => {
    const { session, runtime, entries, definitions } = await fixture();
    const archived = await runtime.prepare(definitions[0].reference!, { taskId: 'archive', reason: 'explicit', maxTokens: 1_000 });
    entries[0].reference = archived.reference;
    entries[0].quality = 'preferred';
    entries[0].automatic = true;
    definitions[0].reference = archived.reference;
    await session.beginTask('review code');
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    expect(packets[0].reason).toBe('local');
    await session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content)));
    await session.beginTask('hello');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('drops an unrelated prior automatic selection without resynchronizing its unchanged registry activation', async () => {
    const { session } = await fixture();
    await session.beginTask('review code');
    await session.prepareRequest({ maxTokens: 1_000 });
    await session.beginTask('Write the release notes.');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('reuses the exact attested cached revision when the next task remains relevant', async () => {
    const { session, definitions } = await fixture();
    await session.beginTask('review code');
    const first = await session.prepareRequest({ maxTokens: 1_000 });
    await session.acknowledgeRequest(first, observation(first.map(packet => packet.content)));
    await writeFile(definitions[0].path, 'Changed live source.');
    await session.beginTask('review code again');
    const next = await session.prepareRequest({ maxTokens: 1_000 });
    expect(next[0].reference).toEqual(first[0].reference);
    expect(next[0].content).toBe(first[0].content);
  });

  it('preserves restored goal pins across unrelated task instructions and greetings', async () => {
    const { session, runtime, definitions } = await fixture();
    const archived = await runtime.prepare(definitions[0].reference!, { taskId: 'archive', reason: 'explicit', maxTokens: 1_000 });
    session.restorePins([archived.reference]);
    await session.beginTask('hello');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reference).toEqual(archived.reference);
    await session.beginTask('Write the release notes.');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reference).toEqual(archived.reference);
  });

  it('keeps qualified same-name authorities distinct and retains requested resources', async () => {
    const { session, definitions } = await fixture([{ name: 'review', authority: 'project' }, { name: 'review', authority: 'personal' }]);
    await writeFile(path.join(path.dirname(definitions[1].path), 'checks.md'), 'Read the complete independent checks.');
    const qualified = formatSkillReference({ ...definitions[1].reference!, resource: 'checks.md' });
    await session.beginTask(`Use $${qualified}`);
    const [packet] = await session.prepareRequest({ maxTokens: 1_000 });
    expect(packet.reference).toMatchObject({ authority: 'personal', resource: 'checks.md' });
    expect(packet.content).toContain('Read the complete independent checks.');
    expect(definitions[0].isActive).toBe(false);
  });

  it('uses existing brainstorm, debug, and native-computer intent rules without repeated injections', async () => {
    const { session } = await fixture([{ name: 'brainstorm' }, { name: 'systematic-debugging' }, { name: 'computer-control' }]);
    await session.beginTask('tests are failing', { planModeActive: true });
    expect((await session.prepareRequest({ maxTokens: 2_000 })).map(packet => packet.name)).toEqual(['brainstorm']);
    session.reset();
    await session.beginTask('tests are failing');
    expect((await session.prepareRequest({ maxTokens: 2_000 })).map(packet => packet.name)).toContain('systematic-debugging');
    session.reset();
    await session.beginTask('open my browser with $computer-control');
    expect((await session.prepareRequest({ maxTokens: 2_000 })).filter(packet => packet.name === 'computer-control')).toHaveLength(1);
  });

  it('selects a high-confidence local lexical match while abstaining on weak or ambiguous matches', async () => {
    const { session } = await fixture([{ name: 'review', description: 'Review code carefully' }]);
    await session.beginTask('review code');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0]).toMatchObject({ name: 'review', reason: 'local' });
    const weak = await fixture([{ name: 'lint', description: 'Review code carefully' }]);
    await weak.session.beginTask('review');
    expect(await weak.session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    const ambiguous = await fixture([{ name: 'review', description: 'Review code' }, { name: 'review', description: 'Review code', authority: 'personal' }]);
    await ambiguous.session.beginTask('review code');
    expect(await ambiguous.session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('keeps draft-only packages out of automatic selection and agent activation while allowing explicit user inspection', async () => {
    const { session, entries, definitions, registry } = await fixture([{ name: 'brainstorm' }, { name: 'review', description: 'Review code carefully' }]);
    entries.forEach(entry => { entry.automatic = false; entry.quality = 'draft'; });
    await session.beginTask('review code');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    await session.beginTask('brainstorm this design');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    registry.activateSkill('review', 'agent');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    definitions.forEach(skill => { skill.isActive = false; });
    await session.beginTask('$review');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].name).toBe('review');
  });

  it('sends only a bounded authorized ambiguous shortlist to an injected reranker and validates the returned identity', async () => {
    const { registry, definitions, entries } = await fixture([{ name: 'review', description: 'Review code' }, { name: 'review', description: 'Review code', authority: 'personal' }, { name: 'private', description: 'Review code', authority: 'secret' }]);
    entries[2].enabled = false;
    const rerank = vi.fn(async () => definitions[1].reference!);
    const session = new AdaptiveSkillSession({ registry, rerank });
    await session.beginTask('review code');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reference.authority).toBe('personal');
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(rerank.mock.calls[0][0].candidates).toHaveLength(2);
    expect(JSON.stringify(rerank.mock.calls[0][0])).not.toContain('secret');
    session.reset();
    definitions.forEach(skill => { skill.isActive = false; });
    rerank.mockResolvedValueOnce({ authority: 'secret', packageId: 'private' });
    await session.beginTask('review code');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('falls back to local abstention on reranker errors without dispatching inference itself', async () => {
    const { registry } = await fixture([{ name: 'review' }, { name: 'review', authority: 'personal' }]);
    const session = new AdaptiveSkillSession({ registry, rerank: async () => { throw new Error('Decision unavailable'); } });
    await session.beginTask('review');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('validates reranker output against the original shortlist even when its callback mutates request metadata', async () => {
    const { registry, definitions } = await fixture([{ name: 'review' }, { name: 'review', authority: 'personal' }, { name: 'unrelated' }]);
    const session = new AdaptiveSkillSession({ registry, rerank: async request => {
      Object.assign(request.candidates[0].reference, definitions[2].reference);
      return request.candidates[0].reference;
    } });
    await session.beginTask('review');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    expect(definitions[2].isActive).toBe(false);
  });

  it('rechecks current authorization and deactivation before returning cached instructions', async () => {
    const { session, entries, definitions } = await fixture();
    await session.beginTask('$review');
    await session.prepareRequest({ maxTokens: 1_000 });
    entries[0].enabled = false;
    await expect(session.prepareRequest({ maxTokens: 1_000 })).rejects.toThrow(/required|authoriz|available/i);
    entries[0].enabled = true;
    definitions[0].isActive = false;
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('prepares a skill activated by a tool after task selection and removes it after deactivation', async () => {
    const { session, registry, definitions } = await fixture();
    await session.beginTask('hello');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
    registry.activateSkill('review', 'agent');
    const [packet] = await session.prepareRequest({ maxTokens: 1_000 });
    expect(packet).toMatchObject({ name: 'review', reason: 'agent' });
    expect(packet.content).toContain(definitions[0].body);
    definitions[0].isActive = false;
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('preserves an exact revision and resource activated mid-task through the registry', async () => {
    const { session, runtime, registry, definitions } = await fixture();
    await writeFile(path.join(path.dirname(definitions[0].path), 'checks.md'), 'Original archived independent checks.');
    const retained = await runtime.prepare(definitions[0].reference!, { taskId: 'archive', reason: 'explicit', maxTokens: 1_000 });
    await writeFile(definitions[0].path, 'Updated upstream source.');
    await session.beginTask('hello');
    const selected = { ...retained.reference, resource: 'checks.md' };
    registry.activateSkill(formatSkillReference(selected));
    const [packet] = await session.prepareRequest({ maxTokens: 1_000 });
    expect(packet.reference).toEqual(selected);
    expect(packet.reason).toBe('explicit');
    expect(packet.content).toContain('Original archived independent checks.');
    expect(packet.content).toContain(definitions[0].body);
  });

  it('rejects known excluded explicit skills and unavailable qualified references without activating them', async () => {
    const { session, entries, registry } = await fixture();
    entries[0].enabled = false;
    await expect(session.beginTask('$review')).rejects.toThrow(/available|authoriz|excluded/i);
    expect(registry.activateSkill).not.toHaveBeenCalled();
    await expect(session.beginTask('skill://missing/review')).rejects.toThrow(/available|authoriz/i);
  });

  it('caches packet bodies across requests and compaction while recording per-request receipts only once in UI rows', async () => {
    const { session, runtime } = await fixture();
    await session.beginTask('$review', { taskId: 'task' });
    const prepare = vi.spyOn(runtime, 'prepare');
    const first = await session.prepareRequest({ maxTokens: 1_000 });
    const second = await session.prepareRequest({ maxTokens: 1_000 });
    expect(second).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await session.acknowledgeRequest(first, observation(first.map(packet => packet.content), 'request-1'))).toHaveLength(1);
    expect(await session.acknowledgeRequest(second, observation(second.map(packet => packet.content), 'request-2'))).toEqual([]);
    expect(runtime.receipts()).toHaveLength(2);
    prepare.mockClear();
    const rebuilt = await session.prepareRequest({ maxTokens: 1_000 });
    expect(rebuilt[0].content).toBe(first[0].content);
    expect(prepare).not.toHaveBeenCalled();
    expect(await session.acknowledgeRequest(rebuilt, observation(rebuilt.map(packet => packet.content), 'request-3'))).toEqual([]);
    expect(session.getPinnedReferences()).toEqual([first[0].reference]);
  });

  it('rejects a source mutation before the first accepted request without emitting a loaded row', async () => {
    const { session, definitions, runtime } = await fixture();
    await session.beginTask('$review');
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    await writeFile(definitions[0].path, 'Changed source before any accepted request.');
    await expect(session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content)))).rejects.toThrow(/revision|changed/i);
    expect(runtime.receipts()).toEqual([]);
  });

  it('rejects changed source before retrying a prepared request that was never acknowledged', async () => {
    const { session, definitions, runtime } = await fixture();
    await session.beginTask('$review');
    await session.prepareRequest({ maxTokens: 1_000 });
    await writeFile(definitions[0].path, 'Changed source after a rejected first request.');
    await expect(session.prepareRequest({ maxTokens: 1_000 })).rejects.toThrow(/revision|changed/i);
    expect(runtime.receipts()).toEqual([]);
  });

  it('keeps an actually submitted exact revision after source changes, including the next task', async () => {
    const { session, definitions } = await fixture();
    await session.beginTask('$review', { taskId: 'first-task' });
    const first = await session.prepareRequest({ maxTokens: 1_000 });
    await session.acknowledgeRequest(first, observation(first.map(packet => packet.content)));
    await writeFile(definitions[0].path, 'New upstream instructions.');
    const retained = await session.prepareRequest({ maxTokens: 1_000 });
    expect(retained[0].content).toBe(first[0].content);
    expect(await session.acknowledgeRequest(retained, observation(retained.map(packet => packet.content), 'second'))).toEqual([]);
    await session.beginTask('Continue the approved work.', { taskId: 'second-task' });
    const continued = await session.prepareRequest({ maxTokens: 1_000 });
    expect(continued[0].reference).toEqual(first[0].reference);
    expect(await session.acknowledgeRequest(continued, observation(continued.map(packet => packet.content), 'third'))).toHaveLength(1);
  });

  it('restores exact pins through the canonical archive and never substitutes a missing revision', async () => {
    const { session, definitions, registry } = await fixture();
    await session.beginTask('$review');
    const [packet] = await session.prepareRequest({ maxTokens: 1_000 });
    await writeFile(definitions[0].path, 'Changed upstream instructions.');
    const restored = new AdaptiveSkillSession({ registry });
    restored.restorePins([packet.reference]);
    await restored.beginTask('Continue', { taskId: 'restored-task' });
    const [restoredPacket] = await restored.prepareRequest({ maxTokens: 1_000 });
    expect(restoredPacket).toMatchObject({ reference: packet.reference, reason: 'restored' });
    expect(restoredPacket.content).toBe(packet.content);
    restored.reset();
    restored.restorePins([{ ...packet.reference, revision: `sha256:${'0'.repeat(64)}` }]);
    await restored.beginTask('Continue');
    await expect(restored.prepareRequest({ maxTokens: 1_000 })).rejects.toThrow(/revision|available/i);
  });

  it('reports missing restored package identities instead of silently discarding the pin', async () => {
    const { session } = await fixture();
    session.restorePins([{ authority: 'removed', packageId: 'review', revision: `sha256:${'0'.repeat(64)}` }]);
    await expect(session.beginTask('Continue the approved work.')).rejects.toThrow(/pin|available|authoriz/i);
  });

  it('keeps goal-restored activation agent-owned until an explicit user invocation promotes it', async () => {
    const { session, registry, runtime, definitions } = await fixture();
    const packet = await runtime.prepare(definitions[0].reference!, { taskId: 'archive', reason: 'explicit', maxTokens: 1_000 });
    session.restorePins([packet.reference]);
    await session.beginTask('Continue the approved work.');
    expect(registry.getActivationOrigin(definitions[0])).toBe('agent');
    await session.beginTask('$review');
    expect(registry.getActivationOrigin(definitions[0])).toBe('user');
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reason).toBe('restored');
  });

  it('preserves an existing user activation when restoring an approved goal pin', async () => {
    const { session, registry, runtime, definitions } = await fixture();
    const packet = await runtime.prepare(definitions[0].reference!, { taskId: 'archive', reason: 'explicit', maxTokens: 1_000 });
    registry.activateSkill('review');
    session.restorePins([packet.reference]);
    await session.beginTask('Continue the approved work.');
    expect(registry.getActivationOrigin(definitions[0])).toBe('user');
  });

  it('rejects conflicting restored revisions without replacing the existing session pins', async () => {
    const { session } = await fixture();
    await session.beginTask('$review');
    const [packet] = await session.prepareRequest({ maxTokens: 1_000 });
    expect(() => session.restorePins([packet.reference, { ...packet.reference, revision: `sha256:${'0'.repeat(64)}` }])).toThrow(/conflict|revision/i);
    expect(session.getPinnedReferences()).toEqual([packet.reference]);
  });

  it('coalesces embedded dependency bodies while acknowledging and retaining every exact dependency pin', async () => {
    const { session, entries, runtime } = await fixture([{ name: 'review' }, { name: 'check' }]);
    entries[0].dependencies = [entries[1].reference];
    await session.beginTask('$review $check');
    const packets = await session.prepareRequest({ maxTokens: 10_000 });
    expect(packets.map(packet => packet.name)).toEqual(['review']);
    const receipts = await session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content)));
    expect(receipts.map(receipt => receipt.reference.packageId)).toEqual(['review', 'check']);
    expect(session.getPinnedReferences().map(reference => reference.packageId)).toEqual(['review', 'check']);
    expect(runtime.receipts()).toHaveLength(2);
    entries[1].enabled = false;
    await expect(session.prepareRequest({ maxTokens: 10_000 })).rejects.toThrow(/dependency|authoriz/i);
  });

  it('honors deactivation while preparation is pending and avoids leaking its completed packet', async () => {
    const { session, runtime, definitions } = await fixture();
    const originalPrepare = runtime.prepare.bind(runtime);
    vi.spyOn(runtime, 'prepare').mockImplementationOnce(async (...args) => {
      const packet = await originalPrepare(...args);
      definitions[0].isActive = false;
      return packet;
    });
    await session.beginTask('$review');
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('retains explicit selection provenance when the user mentions an automatically selected active skill', async () => {
    const { session, registry } = await fixture();
    await session.beginTask('review code', { taskId: 'task' });
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reason).toBe('local');
    await session.beginTask('$review', { taskId: 'task' });
    expect((await session.prepareRequest({ maxTokens: 1_000 }))[0].reason).toBe('explicit');
    expect(registry.activateSkill).toHaveBeenLastCalledWith(expect.any(String), 'user');
  });

  it('enforces aggregate token budgets without truncation and isolates returned packet mutations from cache', async () => {
    const { session } = await fixture([{ name: 'review' }, { name: 'test' }]);
    await session.beginTask('$review $test');
    const packets = await session.prepareRequest({ maxTokens: 10_000 });
    const budget = Math.max(...packets.map(packet => packet.estimatedTokens));
    await expect(session.prepareRequest({ maxTokens: budget })).rejects.toThrow(/budget|tokens/i);
    packets[0].content = 'caller mutation';
    expect((await session.prepareRequest({ maxTokens: 10_000 }))[0].content).not.toBe('caller mutation');
  });

  it('acknowledges external attachment only as supplied and clears session state on reset', async () => {
    const { registry } = await fixture();
    const session = new AdaptiveSkillSession({ registry, adapter: 'external' });
    await session.beginTask('$review');
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    expect((await session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content))))[0]).toMatchObject({ state: 'supplied', capability: 'external-handoff' });
    session.reset();
    expect(session.getPinnedReferences()).toEqual([]);
    expect(await session.prepareRequest({ maxTokens: 1_000 })).toEqual([]);
  });

  it('rejects cancelled selection/preparation/acknowledgement and stale tasks without creating receipts', async () => {
    const { session, runtime } = await fixture();
    const controller = new AbortController();
    controller.abort(new Error('Cancelled'));
    await expect(session.beginTask('$review', { signal: controller.signal })).rejects.toThrow('Cancelled');
    await session.beginTask('$review');
    await expect(session.prepareRequest({ maxTokens: 1_000, signal: controller.signal })).rejects.toThrow('Cancelled');
    const packets = await session.prepareRequest({ maxTokens: 1_000 });
    await expect(session.acknowledgeRequest(packets, { ...observation(packets.map(packet => packet.content)), signal: controller.signal })).rejects.toThrow('Cancelled');
    await session.beginTask('new task');
    await expect(session.acknowledgeRequest(packets, observation(packets.map(packet => packet.content)))).rejects.toThrow(/task|stale/i);
    expect(runtime.receipts()).toEqual([]);
  });
});
