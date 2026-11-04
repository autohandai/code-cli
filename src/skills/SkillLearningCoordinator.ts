import type { SkillReference } from './SkillRuntime.js';
import {
  SkillLearningConflictError,
  createSkillLearningJobId,
  type LearnedSkillCandidate, type SkillAcceptanceContract, type SkillAcceptanceContractInput,
  type SkillBenefitEvidence, type SkillBenefitPlan, type SkillCheckEvidence, type SkillDraftProposal,
  type SkillLearningJob, type SkillLearningStore, type SkillOutcomeInput, type SkillOutcomeRecord,
  type SkillSourceSnapshot, type PinnedSkillReference,
} from './SkillLearningStore.js';

export interface SkillLearningPolicy {
  allowed: boolean;
  automaticLearning?: boolean;
  epoch: string;
  provider: string;
}
export interface SkillLearningCoordinatorOptions {
  store: SkillLearningStore;
  extractorVersion: string;
  policy(context: { scope: string; mode: 'automatic' | 'explicit' }): SkillLearningPolicy | Promise<SkillLearningPolicy>;
  checkOutcome?(input: SkillOutcomeInput, contract: SkillAcceptanceContract, signal: AbortSignal): Promise<SkillCheckEvidence | null>;
  resolveSource?(reference: PinnedSkillReference, scope: string): Promise<SkillSourceSnapshot | null>;
  extract(job: SkillLearningJob, outcome: SkillOutcomeRecord, source: SkillSourceSnapshot | undefined, signal: AbortSignal): Promise<SkillDraftProposal>;
  verification?: {
    contractId: string; contractRevision: string;
    check(candidate: LearnedSkillCandidate, signal: AbortSignal): Promise<SkillCheckEvidence>;
  };
  benefit?: {
    plan(planId: string, candidate: LearnedSkillCandidate): Promise<Omit<SkillBenefitPlan, 'declaredAt' | 'candidateId' | 'candidateRevision' | 'scope'>>;
    check(plan: SkillBenefitPlan, candidate: LearnedSkillCandidate, signal: AbortSignal): Promise<SkillBenefitEvidence>;
  };
  timeoutMs?: number;
  now?: () => number;
}

function independent(evidence: SkillCheckEvidence | null | undefined): evidence is SkillCheckEvidence {
  return evidence?.provenance === 'independent-host' && evidence.passed && evidence.inputIds.length > 0
    && evidence.checkIds.length > 0 && evidence.environmentId.length > 0 && Number.isFinite(Date.parse(evidence.observedAt));
}
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function artifactHash(value: string): string { return value.replace(/^sha256:/, ''); }
function samePin(left: PinnedSkillReference, right: PinnedSkillReference): boolean {
  return left.authority === right.authority && left.packageId === right.packageId && left.revision === right.revision;
}

export class SkillLearningCoordinator {
  private readonly options: SkillLearningCoordinatorOptions;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  constructor(options: SkillLearningCoordinatorOptions) {
    this.options = Object.freeze({ ...options,
      verification: options.verification ? Object.freeze({ ...options.verification }) : undefined,
      benefit: options.benefit ? Object.freeze({ ...options.benefit }) : undefined,
    });
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 300_000) throw new Error('Invalid learning timeout');
  }

  async registerAcceptanceContract(input: SkillAcceptanceContractInput): Promise<SkillAcceptanceContract> {
    await this.assertAllowed(input.scope);
    if (!unique(input.requiredCheckIds) || !unique(input.inputIds) || !unique(input.artifactBaselines.map(value => value.artifactId))) {
      throw new Error('Acceptance contract identities must be unique');
    }
    return this.options.store.registerAcceptanceContract(input);
  }

  async recordOutcome(input: SkillOutcomeInput): Promise<SkillOutcomeRecord> {
    const policy = await this.options.policy({ scope: input.scope, mode: 'automatic' });
    let verification: SkillCheckEvidence | undefined;
    if (policy.allowed && input.kind === 'work' && input.acceptanceContractId && this.options.checkOutcome) {
      const contract = (await this.options.store.snapshot()).contracts.find(value => value.id === input.acceptanceContractId);
      if (contract && contract.taskId === input.taskId && contract.scope === input.scope) {
        try {
          const observed = await this.bounded(signal => this.options.checkOutcome!(structuredClone(input), structuredClone(contract), signal));
          const evidence = observed ? structuredClone(observed) : null;
          const baselines = new Map(contract.artifactBaselines.map(value => [value.artifactId, artifactHash(value.digest)]));
          const witnesses = evidence?.artifactWitnesses ?? [];
          const changed = witnesses.some(value => baselines.get(value.artifactId) === artifactHash(value.beforeDigest)
            && artifactHash(value.beforeDigest) !== artifactHash(value.afterDigest) && evidence?.artifactIds.includes(value.artifactId));
          if (independent(evidence) && evidence.nontrivial === true && changed
            && evidence.contractId === contract.id && evidence.contractRevision === contract.revision
            && contract.requiredCheckIds.every(id => evidence.checkIds.includes(id))
            && evidence.inputIds.every(id => contract.inputIds.includes(id))
            && evidence.inputIds.length === contract.inputIds.length && unique(evidence.inputIds)
            && Date.parse(evidence.observedAt) >= Date.parse(contract.registeredAt)
            && Date.parse(evidence.observedAt) <= this.now()) verification = evidence;
        } catch {
          verification = undefined;
        }
      }
    }
    const intent = policy.allowed && policy.automaticLearning === true && verification
      ? { extractorVersion: this.options.extractorVersion, mode: 'automatic' as const, provider: policy.provider, policyEpoch: policy.epoch } : undefined;
    const outcome = await this.options.store.commitOutcome(input, verification, intent);
    if (policy.allowed && policy.automaticLearning === true && outcome.kind === 'work' && outcome.verification
      && outcome.pendingLearning?.mode === 'automatic' && outcome.pendingLearning.extractorVersion === this.options.extractorVersion) {
      const current = await this.options.policy({ scope: input.scope, mode: 'automatic' });
      if (current.allowed && current.automaticLearning === true && current.epoch === policy.epoch && current.provider === policy.provider) {
        await this.options.store.enqueue(outcome.id, { extractorVersion: this.options.extractorVersion, mode: 'automatic', provider: current.provider, policyEpoch: current.epoch });
      }
    }
    return outcome;
  }

  async requestDraft(input: SkillOutcomeInput): Promise<SkillLearningJob | null> {
    const policy = await this.assertAllowed(input.scope);
    const intent = { extractorVersion: this.options.extractorVersion, mode: 'explicit' as const, provider: policy.provider, policyEpoch: policy.epoch };
    const outcome = await this.options.store.commitOutcome(input, undefined, input.kind === 'work' ? intent : undefined);
    if (outcome.kind !== 'work') return null;
    return this.options.store.enqueue(outcome.id, { extractorVersion: this.options.extractorVersion, mode: 'explicit', provider: policy.provider, policyEpoch: policy.epoch });
  }

  async processPending(limit = 1): Promise<Array<{ jobId: string; state: 'published' | 'failed' | 'cancelled' }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('Learning batch must contain 1-10 jobs');
    const results: Array<{ jobId: string; state: 'published' | 'failed' | 'cancelled' }> = [];
    const processed = new Set<string>();
    let recovered = 0;
    for (const outcome of (await this.options.store.snapshot()).outcomes) {
      const intent = outcome.pendingLearning;
      if (!intent || intent.extractorVersion !== this.options.extractorVersion
        || outcome.jobKeys.includes(createSkillLearningJobId(outcome, intent.extractorVersion))) continue;
      if (recovered >= limit) break;
      recovered += 1;
      const policy = await this.options.policy({ scope: outcome.scope, mode: intent.mode });
      if (policy.allowed && (intent.mode === 'explicit' || policy.automaticLearning === true)
        && policy.epoch === intent.policyEpoch && policy.provider === intent.provider) await this.options.store.enqueue(outcome.id, intent);
    }
    for (let index = 0; index < limit; index += 1) {
      const job = await this.options.store.claimNext(processed);
      if (!job) break;
      processed.add(job.id);
      try {
        await this.assertCurrent(job);
        const outcome = (await this.options.store.snapshot()).outcomes.find(value => value.id === job.outcomeId);
        if (!outcome) throw new SkillLearningConflictError('Learning source outcome was removed');
        const source = await this.resolveSource(job);
        if (await this.options.store.recoverPublished(job)) {
          results.push({ jobId: job.id, state: 'published' });
          continue;
        }
        if (job.recoveryOnly) throw new Error('Learning extraction retry capacity reached');
        if (source) await this.options.store.archiveSource(source);
        const proposal = await this.bounded(signal => this.options.extract(structuredClone(job), structuredClone(outcome),
          source ? { reference: { ...source.reference }, files: new Map([...source.files].map(([resource, content]) => [resource, Uint8Array.from(content)])) } : undefined, signal));
        await this.options.store.publishDraft(job, proposal, async () => {
          await this.assertCurrent(job);
          await this.resolveSource(job);
        });
        results.push({ jobId: job.id, state: 'published' });
      } catch (error) {
        const state = error instanceof SkillLearningConflictError ? 'cancelled' : 'failed';
        await this.options.store.finishJob(job, state, error instanceof SkillLearningConflictError ? error.message : 'Learning operation failed; source outcome retained').catch(() => {});
        results.push({ jobId: job.id, state });
      }
    }
    return results;
  }

  async list(scope?: string): Promise<LearnedSkillCandidate[]> {
    const state = await this.options.store.snapshot();
    const candidates: LearnedSkillCandidate[] = [];
    for (const candidate of state.candidates) {
      if (scope && candidate.scope !== scope) continue;
      if ((await this.options.policy({ scope: candidate.scope, mode: 'explicit' })).allowed) candidates.push(candidate);
    }
    return candidates;
  }

  async jobs(scope?: string): Promise<SkillLearningJob[]> {
    const jobs: SkillLearningJob[] = [];
    for (const job of (await this.options.store.snapshot()).jobs) {
      if (scope && job.scope !== scope) continue;
      if ((await this.options.policy({ scope: job.scope, mode: 'explicit' })).allowed) jobs.push(job);
    }
    return jobs;
  }

  async inspect(id: string): Promise<LearnedSkillCandidate> {
    const candidate = (await this.options.store.snapshot()).candidates.find(value => value.id === id);
    if (!candidate) throw new Error('Learned skill candidate not found');
    await this.assertAllowed(candidate.scope);
    return this.options.store.getCandidate(id);
  }

  async verify(id: string): Promise<LearnedSkillCandidate> {
    const verifier = this.options.verification;
    if (!verifier) throw new Error('No independently maintained verification contract is configured');
    const candidate = await this.inspect(id);
    const evidence = await this.bounded(signal => verifier.check(structuredClone(candidate), signal));
    if (!independent(evidence) || evidence.candidateRevision !== candidate.reference.revision
      || evidence.contractId !== verifier.contractId || evidence.contractRevision !== verifier.contractRevision) {
      throw new Error('Independent verification did not pass for the exact revision and maintained contract');
    }
    const state = await this.options.store.snapshot();
    const outcome = state.outcomes.find(value => value.id === candidate.outcomeId);
    const contract = state.contracts.find(value => value.id === outcome?.acceptanceContractId);
    const sourceInputs = new Set(outcome?.verification?.inputIds ?? contract?.inputIds ?? []);
    if (!unique(evidence.inputIds) || evidence.inputIds.some(input => sourceInputs.has(input))
      || Date.parse(evidence.observedAt) < Date.parse(candidate.createdAt) || Date.parse(evidence.observedAt) > this.now()) {
      throw new Error('Verification requires fresh independent inputs after candidate publication');
    }
    await this.assertAllowed(candidate.scope);
    return this.options.store.updateCandidate(id, candidate.reference.revision, { status: 'verified', verification: evidence, benefit: undefined });
  }

  async declareBenefitPlan(id: string, planId: string): Promise<SkillBenefitPlan> {
    if (!this.options.benefit) throw new Error('No independent benefit evaluator is configured');
    const candidate = await this.inspect(id);
    const state = await this.options.store.snapshot();
    const existing = state.plans.find(value => value.id === planId);
    if (existing) {
      if (existing.candidateId !== id || existing.candidateRevision !== candidate.reference.revision) throw new SkillLearningConflictError('Benefit-plan identity conflict');
      return existing;
    }
    const plan = await this.options.benefit.plan(planId, structuredClone(candidate));
    const outcome = state.outcomes.find(value => value.id === candidate.outcomeId);
    const contract = state.contracts.find(value => value.id === outcome?.acceptanceContractId);
    const usedInputs = new Set([...(outcome?.verification?.inputIds ?? contract?.inputIds ?? []), ...(candidate.verification?.inputIds ?? [])]);
    const inputs = [...plan.inputIds, ...plan.negativeTransferInputIds];
    if (plan.id !== planId || !unique(inputs) || inputs.some(input => usedInputs.has(input))) {
      throw new Error('Benefit plan requires predeclared disjoint held-out and negative-transfer inputs');
    }
    return this.options.store.declareBenefitPlan({ ...plan, candidateId: id, candidateRevision: candidate.reference.revision,
      scope: candidate.scope, declaredAt: new Date(this.now()).toISOString() });
  }

  async prefer(id: string, planId: string): Promise<LearnedSkillCandidate> {
    if (!this.options.benefit) throw new Error('No independent benefit evaluator is configured');
    const candidate = await this.inspect(id);
    if (candidate.status !== 'verified' || !candidate.verification) throw new Error('Verify the exact candidate before preference evaluation');
    const plan = (await this.options.store.snapshot()).plans.find(value => value.id === planId && value.candidateId === id);
    if (!plan || plan.candidateRevision !== candidate.reference.revision) throw new Error('A frozen predeclared benefit plan is required');
    const evidence = await this.bounded(signal => this.options.benefit!.check(structuredClone(plan), structuredClone(candidate), signal));
    const expectedInputs = [...plan.inputIds, ...plan.negativeTransferInputIds];
    if (evidence.provenance !== 'independent-host' || evidence.planId !== plan.id
      || evidence.candidateRevision !== candidate.reference.revision || evidence.baselineRevision !== plan.baselineRevision
      || evidence.contractId !== plan.contractId || evidence.contractRevision !== plan.contractRevision
      || !unique(evidence.comparisons.map(value => value.inputId)) || evidence.comparisons.length !== expectedInputs.length
      || evidence.comparisons.some(value => !expectedInputs.includes(value.inputId)
        || Date.parse(value.observedAt) <= Date.parse(plan.declaredAt) || Date.parse(value.observedAt) > this.now()
        || !Number.isFinite(value.baselineValue) || !Number.isFinite(value.candidateValue)
        || (value.baselinePassed && !value.candidatePassed))) {
      throw new Error('Independent paired held-out and negative-transfer evidence is incomplete or stale');
    }
    const delta = (value: SkillBenefitEvidence['comparisons'][number]): number => plan.metric === 'quality'
      ? value.candidateValue - value.baselineValue : value.baselineValue - value.candidateValue;
    const heldOut = evidence.comparisons.filter(value => plan.inputIds.includes(value.inputId));
    const negative = evidence.comparisons.filter(value => plan.negativeTransferInputIds.includes(value.inputId));
    if (heldOut.some(value => !value.candidatePassed)
      || heldOut.reduce((total, value) => total + delta(value), 0) / heldOut.length < plan.minimumBenefit
      || negative.some(value => delta(value) < -plan.nonInferiorityMargin)) {
      throw new Error('Declared benefit or negative-transfer acceptance margin did not pass');
    }
    await this.assertAllowed(candidate.scope);
    return this.options.store.updateCandidate(id, candidate.reference.revision, { status: 'preferred', benefit: evidence });
  }

  async rollback(id: string): Promise<LearnedSkillCandidate> {
    const candidate = await this.inspect(id);
    return this.options.store.updateCandidate(id, candidate.reference.revision, { status: 'superseded', verification: undefined, benefit: undefined });
  }
  async exclude(reference: SkillReference, scope: string): Promise<void> {
    await this.assertAllowed(scope);
    await this.options.store.exclude(reference, scope);
  }
  async deleteEvidence(reference: SkillReference, scope: string): Promise<void> {
    await this.assertAllowed(scope);
    await this.options.store.exclude(reference, scope, true);
  }
  private async assertAllowed(scope: string): Promise<SkillLearningPolicy> {
    const policy = await this.options.policy({ scope, mode: 'explicit' });
    if (!policy.allowed) throw new SkillLearningConflictError('Learning is not authorized in this scope');
    return policy;
  }
  private async assertCurrent(job: SkillLearningJob): Promise<void> {
    const policy = await this.options.policy({ scope: job.scope, mode: job.mode });
    if (job.extractorVersion !== this.options.extractorVersion || !policy.allowed || (job.mode === 'automatic' && policy.automaticLearning !== true)
      || policy.epoch !== job.policyEpoch || policy.provider !== job.provider) throw new SkillLearningConflictError('Learning policy changed');
  }
  private async resolveSource(job: SkillLearningJob): Promise<SkillSourceSnapshot | undefined> {
    if (!job.source) return undefined;
    const source = await this.bounded(() => this.options.resolveSource?.(job.source!, job.scope) ?? Promise.resolve(null));
    if (!source || !samePin(source.reference, job.source)) throw new SkillLearningConflictError('Source revision changed or is no longer authorized');
    await this.options.store.archiveSource(source);
    return source;
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let rejectOnAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(new Error('Learning operation timed out'));
      signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    try { return await Promise.race([operation(signal), aborted]); }
    finally { if (rejectOnAbort) signal.removeEventListener('abort', rejectOnAbort); }
  }
}
