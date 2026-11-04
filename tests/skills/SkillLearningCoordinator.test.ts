import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLearningCoordinator, type SkillLearningCoordinatorOptions } from '../../src/skills/SkillLearningCoordinator.js';
import { SkillLearningStore, type SkillLearningStoreOptions, type SkillOutcomeInput } from '../../src/skills/SkillLearningStore.js';
import { computeSkillRevision, createSkillRevisionManifest } from '../../src/skills/SkillRevisionStore.js';

const roots: string[] = [];
const files = new Map([['SKILL.md', Buffer.from('---\nname: checked-work\ndescription: Validate reusable work\n---\nCheck observable outputs.\n')]]);
const outcome: SkillOutcomeInput = { id: 'outcome-one', taskId: 'task-one', scope: 'project:one', kind: 'work', evidenceRefs: ['check:one'], acceptanceContractId: 'acceptance' };
const attestation = () => ({ provenance: 'independent-host' as const, passed: true, nontrivial: true, contractId: 'acceptance', contractRevision: 'v1', inputIds: ['source-input'], checkIds: ['check:one'], artifactIds: ['artifact:one'], artifactWitnesses: [{ artifactId: 'artifact:one', beforeDigest: 'a'.repeat(64), afterDigest: 'b'.repeat(64) }], environmentId: 'fixture-only', observedAt: new Date().toISOString() });

async function setup(overrides: Partial<SkillLearningCoordinatorOptions> = {}, storeOptions: SkillLearningStoreOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-learning-'));
  roots.push(root);
  const store = new SkillLearningStore(root, { now: overrides.now, ...storeOptions });
  const extract = vi.fn(async () => ({ files }));
  const options: SkillLearningCoordinatorOptions = {
    store, extractorVersion: 'fixture-extractor-v1', extract,
    checkOutcome: async () => attestation(),
    policy: () => ({ automaticLearning: false, allowed: true, epoch: 'one', provider: 'fixture-local' }),
    ...overrides,
  };
  const coordinator = new SkillLearningCoordinator(options);
  await coordinator.registerAcceptanceContract({ id: 'acceptance', revision: 'v1', taskId: outcome.taskId, scope: outcome.scope,
    inputIds: ['source-input'], requiredCheckIds: ['check:one'], artifactBaselines: [{ artifactId: 'artifact:one', digest: 'a'.repeat(64) }] });
  return { root, store, extract, coordinator, options };
}

afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.remove(root))); });

describe('SkillLearningCoordinator', () => {
  it('persists independently verified work before extraction and defaults automatic learning off', async () => {
    const { coordinator, store, extract } = await setup();
    await coordinator.recordOutcome(outcome);
    expect((await store.snapshot()).outcomes).toHaveLength(1);
    expect((await store.snapshot()).jobs).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it.each(['greeting', 'cancelled', 'noop', 'clean-exit'] as const)('never learns from %s or trusts a completion flag', async kind => {
    const { coordinator, store, extract } = await setup({ policy: () => ({ automaticLearning: true, allowed: true, epoch: 'one', provider: 'fixture-local' }) });
    await coordinator.recordOutcome({ ...outcome, kind });
    expect((await store.snapshot()).jobs).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects model-reported acceptance checks despite a success-shaped payload', async () => {
    const { coordinator, store } = await setup({ checkOutcome: async () => ({ ...attestation(), provenance: 'reported' }) });
    await coordinator.recordOutcome(outcome);
    expect((await store.snapshot()).outcomes[0]?.verification).toBeUndefined();
    expect((await store.snapshot()).jobs).toEqual([]);
  });

  it.each(['a'.repeat(64), `sha256:${'a'.repeat(64)}`])('rejects clean no-op artifact digest %s and weakened frozen checks', async afterDigest => {
    const { coordinator, store } = await setup({
      policy: () => ({ automaticLearning: true, allowed: true, epoch: 'one', provider: 'fixture-local' }),
      checkOutcome: async () => ({ ...attestation(), artifactWitnesses: [{ artifactId: 'artifact:one', beforeDigest: 'a'.repeat(64), afterDigest }] }),
    });
    await coordinator.recordOutcome(outcome);
    expect((await store.snapshot()).outcomes[0]?.verification).toBeUndefined();
    expect((await store.snapshot()).jobs).toEqual([]);
    await expect(coordinator.registerAcceptanceContract({ id: 'acceptance', revision: 'weaker-v2', taskId: outcome.taskId, scope: outcome.scope, inputIds: ['source-input'], requiredCheckIds: ['weaker-check'], artifactBaselines: [{ artifactId: 'artifact:one', digest: 'a'.repeat(64) }] })).rejects.toThrow(/frozen|cannot change/i);
  });

  it('deduplicates durable jobs, publishes only drafts, and keeps the committed outcome on extraction failure', async () => {
    const { coordinator, store, extract } = await setup({ policy: () => ({ automaticLearning: true, allowed: true, epoch: 'one', provider: 'fixture-local' }) });
    extract.mockRejectedValueOnce(new Error('fixture failure'));
    await Promise.all([coordinator.recordOutcome(outcome), coordinator.recordOutcome(outcome)]);
    expect((await store.snapshot()).jobs).toHaveLength(1);
    await coordinator.processPending();
    expect((await store.snapshot()).outcomes).toHaveLength(1);
    expect((await store.snapshot()).jobs[0]).toMatchObject({ state: 'failed', attempts: 1 });
    await coordinator.processPending();
    const state = await store.snapshot();
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]).toMatchObject({ status: 'draft', outcomeId: outcome.id });
    expect(state.jobs[0]?.state).toBe('published');
    await coordinator.recordOutcome(outcome);
    await coordinator.processPending();
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('recovers opted-in scheduling intent after a crash between outcome persistence and enqueue', async () => {
    const { coordinator, store, options } = await setup({ policy: () => ({ automaticLearning: true, allowed: true, epoch: 'one', provider: 'fixture-local' }) });
    vi.spyOn(store, 'enqueue').mockRejectedValueOnce(new Error('crash before enqueue'));
    await expect(coordinator.recordOutcome(outcome)).rejects.toThrow(/crash before enqueue/);
    expect((await store.snapshot()).outcomes[0]?.verification).toBeDefined();
    expect((await store.snapshot()).jobs).toEqual([]);
    const restarted = new SkillLearningCoordinator(options);
    await restarted.processPending();
    expect((await store.snapshot()).candidates).toHaveLength(1);
    expect((await store.snapshot()).jobs).toHaveLength(1);
  });

  it('bounds extraction attempts even when the final claimed attempt crashes', async () => {
    let now = Date.now();
    const { coordinator, store, extract } = await setup({ now: () => now }, { maxAttempts: 1, leaseMs: 10 });
    await coordinator.requestDraft(outcome);
    await store.claimNext();
    now += 11;
    await coordinator.processPending();
    expect(extract).not.toHaveBeenCalled();
    expect((await store.snapshot()).jobs[0]?.state).toBe('failed');
  });

  it('allows explicit draft authoring without enabling automatic jobs', async () => {
    const { coordinator, store } = await setup();
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    expect((await store.snapshot()).candidates[0]?.status).toBe('draft');
  });

  it('bounds a stalled extractor and discards a result that arrives after timeout', async () => {
    let resolve: ((value: { files: typeof files }) => void) | undefined;
    const { coordinator, store } = await setup({ timeoutMs: 10, extract: async () => new Promise(done => { resolve = done; }) });
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    expect((await store.snapshot()).jobs[0]?.state).toBe('failed');
    resolve!({ files });
    await Promise.resolve();
    expect((await store.snapshot()).candidates).toEqual([]);
  });

  it('releases deadline listeners and leaves timer counts at baseline after completion', async () => {
    const { coordinator, store } = await setup();
    vi.useFakeTimers();
    try {
      const baseline = vi.getTimerCount();
      await coordinator.recordOutcome(outcome);
      await coordinator.requestDraft(outcome);
      await coordinator.processPending();
      expect((await store.snapshot()).candidates).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(baseline);
    } finally { vi.useRealTimers(); }
  });

  it('rechecks policy after extraction so stale work cannot publish', async () => {
    let epoch = 'one';
    const { coordinator, store } = await setup({
      policy: () => ({ automaticLearning: true, allowed: true, epoch, provider: 'fixture-local' }),
      extract: async () => { epoch = 'two'; return { files }; },
    });
    await coordinator.recordOutcome(outcome);
    await coordinator.processPending();
    expect((await store.snapshot()).candidates).toEqual([]);
    expect((await store.snapshot()).jobs[0]?.state).toBe('cancelled');
  });

  it('preserves the exact upstream lineage and rejects a concurrent parent edit', async () => {
    const reference = { authority: 'upstream', packageId: 'checks', revision: computeSkillRevision(createSkillRevisionManifest(files)) };
    let currentFiles = files;
    const { coordinator, store } = await setup({
      resolveSource: async () => ({ reference, files: currentFiles }),
      extract: async () => { currentFiles = new Map([['SKILL.md', Buffer.from('User-edited parent')]]); return { files }; },
    });
    await coordinator.requestDraft({ ...outcome, source: reference });
    await coordinator.processPending();
    expect((await store.snapshot()).candidates).toEqual([]);
    expect((await store.snapshot()).jobs[0]?.state).toBe('cancelled');
    expect(Buffer.from(currentFiles.get('SKILL.md')!).toString()).toBe('User-edited parent');
  });

  it('requires independently maintained checks on fresh inputs for the exact candidate revision', async () => {
    let inputIds = ['source-input'];
    const { coordinator, store } = await setup({ verification: {
      contractId: 'independent-suite', contractRevision: 'frozen-v1',
      check: async candidate => ({ provenance: 'independent-host', passed: true, candidateRevision: candidate.reference.revision, contractId: 'independent-suite', contractRevision: 'frozen-v1', inputIds, checkIds: ['fresh-check'], artifactIds: ['fresh-artifact'], environmentId: 'fixture-only', observedAt: new Date().toISOString() }),
    } });
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    const candidate = (await store.snapshot()).candidates[0]!;
    await expect(coordinator.verify(candidate.id)).rejects.toThrow(/fresh/i);
    inputIds = ['held-out-input'];
    await coordinator.verify(candidate.id);
    expect((await store.snapshot()).candidates[0]?.status).toBe('verified');
    await fs.appendFile(path.join(candidate.packagePath, 'SKILL.md'), '\nUser edit.\n');
    await expect(coordinator.verify(candidate.id)).rejects.toThrow(/changed|conflict/i);
    expect(await fs.readFile(path.join(candidate.packagePath, 'SKILL.md'), 'utf8')).toContain('User edit.');
  });

  it('removes derived jobs and ranking evidence on exclusion without deleting package files', async () => {
    const { coordinator, store } = await setup();
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    const candidate = (await store.snapshot()).candidates[0]!;
    await coordinator.exclude(candidate.reference, candidate.scope);
    expect((await store.snapshot()).candidates[0]?.status).toBe('quarantined');
    await coordinator.deleteEvidence(candidate.reference, candidate.scope);
    expect((await store.snapshot()).candidates).toEqual([]);
    expect(await fs.pathExists(path.join(candidate.packagePath, 'SKILL.md'))).toBe(true);
  });

  it('requires frozen paired held-out benefit and negative-transfer evidence before preference', async () => {
    let now = Date.now();
    let negativeValue = 0.9;
    const { coordinator, store } = await setup({
      now: () => now,
      verification: { contractId: 'fresh', contractRevision: 'v1', check: async candidate => ({
        ...attestation(), candidateRevision: candidate.reference.revision, contractId: 'fresh', inputIds: ['verification-input'], observedAt: new Date(now).toISOString(),
      }) },
      benefit: {
        plan: async id => ({ id, baselineRevision: 'sha256:baseline', contractId: 'paired', contractRevision: 'v1', inputIds: ['held-out'], negativeTransferInputIds: ['negative-transfer'], metric: 'quality', minimumBenefit: 0.1, nonInferiorityMargin: 0.05 }),
        check: async (plan, candidate) => ({ provenance: 'independent-host', planId: plan.id, candidateRevision: candidate.reference.revision, baselineRevision: plan.baselineRevision,
          contractId: plan.contractId, contractRevision: plan.contractRevision, environmentId: 'fixture-only', comparisons: [
            { inputId: 'held-out', baselinePassed: true, candidatePassed: true, baselineValue: 0.5, candidateValue: 0.8, observedAt: new Date(now).toISOString() },
            { inputId: 'negative-transfer', baselinePassed: true, candidatePassed: true, baselineValue: 0.9, candidateValue: negativeValue, observedAt: new Date(now).toISOString() },
          ] }),
      },
    });
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    const candidate = (await store.snapshot()).candidates[0]!;
    await expect(coordinator.prefer(candidate.id, 'paired')).rejects.toThrow(/verify/i);
    await coordinator.verify(candidate.id);
    await expect(coordinator.prefer(candidate.id, 'paired')).rejects.toThrow(/predeclared/i);
    await coordinator.declareBenefitPlan(candidate.id, 'paired');
    await expect(coordinator.prefer(candidate.id, 'paired')).rejects.toThrow(/stale/i);
    now += 1;
    negativeValue = 0.7;
    await expect(coordinator.prefer(candidate.id, 'paired')).rejects.toThrow(/negative-transfer/i);
    expect((await store.snapshot()).candidates[0]?.status).toBe('verified');
    negativeValue = 0.9;
    await coordinator.prefer(candidate.id, 'paired');
    expect((await store.snapshot()).candidates[0]?.status).toBe('preferred');
    await coordinator.rollback(candidate.id);
    expect((await store.snapshot()).candidates[0]?.status).toBe('superseded');
    expect(await fs.pathExists(path.join(candidate.packagePath, 'SKILL.md'))).toBe(true);
  });

  it('rejects benefit plans that reuse candidate-verification inputs', async () => {
    const { coordinator, store } = await setup({
      verification: { contractId: 'fresh', contractRevision: 'v1', check: async candidate => ({ ...attestation(), candidateRevision: candidate.reference.revision, contractId: 'fresh', inputIds: ['verification-input'] }) },
      benefit: { plan: async id => ({ id, baselineRevision: 'sha256:baseline', contractId: 'paired', contractRevision: 'v1', inputIds: ['verification-input'], negativeTransferInputIds: ['negative'], metric: 'quality', minimumBenefit: 0.1, nonInferiorityMargin: 0 }), check: async () => { throw new Error('must not run'); } },
    });
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    const candidate = (await store.snapshot()).candidates[0]!;
    await coordinator.verify(candidate.id);
    await expect(coordinator.declareBenefitPlan(candidate.id, 'paired')).rejects.toThrow(/held-out|fresh|disjoint/i);
  });

  it('does not let the learner replace the independently maintained verifier contract', async () => {
    const verification = { contractId: 'maintained', contractRevision: 'v1', check: async (candidate: { reference: { revision: string } }) => ({ ...attestation(), candidateRevision: candidate.reference.revision, contractId: 'self-authored', inputIds: ['fresh-input'] }) };
    const { coordinator, store } = await setup({ verification });
    verification.contractId = 'self-authored';
    await coordinator.requestDraft(outcome);
    await coordinator.processPending();
    const candidate = (await store.snapshot()).candidates[0]!;
    await expect(coordinator.verify(candidate.id)).rejects.toThrow(/maintained contract/i);
  });
});
