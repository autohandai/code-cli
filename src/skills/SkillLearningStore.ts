import crypto from 'node:crypto';
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { SkillParser } from './SkillParser.js';
import { SkillRevisionStore, computeSkillRevision, createSkillRevisionManifest } from './SkillRevisionStore.js';
import type { SkillReference } from './SkillRuntime.js';

const text = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const refs = z.array(text).max(32);
const artifactDigest = z.string().regex(/^(sha256:)?[a-f0-9]{64}$/);
const artifactBaselineSchema = z.object({ artifactId: text, digest: artifactDigest }).strict();
const artifactWitnessSchema = z.object({ artifactId: text, beforeDigest: artifactDigest, afterDigest: artifactDigest }).strict();
const acceptanceContractSchema = z.object({
  id: text, revision: text, taskId: text, scope: text, inputIds: refs.min(1), requiredCheckIds: refs.min(1),
  artifactBaselines: z.array(artifactBaselineSchema).min(1).max(32), registeredAt: z.iso.datetime(),
}).strict();
const referenceSchema = z.object({ authority: text, packageId: text, revision: text, resource: text.optional() }).strict();
const evidenceSchema = z.object({
  provenance: z.enum(['independent-host', 'reported', 'learner']),
  passed: z.boolean(), nontrivial: z.boolean().optional(),
  contractId: text, contractRevision: text, inputIds: refs.min(1), checkIds: refs.min(1),
  artifactIds: refs, environmentId: text, observedAt: z.iso.datetime(),
  candidateRevision: text.optional(),
  artifactWitnesses: z.array(artifactWitnessSchema).max(32).optional(),
}).strict();
const outcomeInputSchema = z.object({
  id: text, taskId: text, scope: text,
  kind: z.enum(['work', 'greeting', 'cancelled', 'noop', 'clean-exit']),
  source: referenceSchema.optional(), evidenceRefs: refs,
  acceptanceContractId: text.optional(),
  taskContext: z.object({ intent: z.string().max(1_000), observations: z.string().max(3_000) }).strict().optional(),
}).strict();
const learningIntentSchema = z.object({
  extractorVersion: text, mode: z.enum(['automatic', 'explicit']), provider: text, policyEpoch: text,
}).strict();
const outcomeSchema = outcomeInputSchema.extend({
  recordedAt: z.iso.datetime(), verification: evidenceSchema.optional(), jobKeys: z.array(text).max(16),
  pendingLearning: learningIntentSchema.optional(),
});
const jobSchema = z.object({
  id: text, outcomeId: text, source: referenceSchema.optional(), scope: text,
  extractorVersion: text, mode: z.enum(['automatic', 'explicit']), provider: text, policyEpoch: text,
  state: z.enum(['queued', 'running', 'failed', 'published', 'cancelled']),
  attempts: z.number().int().nonnegative(), createdAt: z.iso.datetime(),
  recoveryOnly: z.boolean().optional(),
  lease: z.object({ owner: text, pid: z.number().int(), expiresAt: z.number() }).strict().optional(),
  error: z.string().max(512).optional(), candidateId: text.optional(),
}).strict();
const comparisonSchema = z.object({
  inputId: text, baselinePassed: z.boolean(), candidatePassed: z.boolean(),
  baselineValue: z.number().finite(), candidateValue: z.number().finite(),
  observedAt: z.iso.datetime(),
}).strict();
const benefitPlanSchema = z.object({
  id: text, candidateId: text, candidateRevision: text, scope: text,
  baselineRevision: text, contractId: text, contractRevision: text,
  inputIds: refs.min(1), negativeTransferInputIds: refs.min(1),
  metric: z.enum(['quality', 'cost']), minimumBenefit: z.number().positive(),
  nonInferiorityMargin: z.number().nonnegative(), declaredAt: z.iso.datetime(),
}).strict();
const benefitEvidenceSchema = z.object({
  provenance: z.enum(['independent-host', 'reported', 'learner']),
  planId: text, candidateRevision: text, baselineRevision: text,
  contractId: text, contractRevision: text, environmentId: text,
  comparisons: z.array(comparisonSchema).min(2).max(64),
}).strict();
const candidateSchema = z.object({
  id: text, jobId: text, outcomeId: text, scope: text,
  reference: referenceSchema, parent: referenceSchema.optional(),
  packagePath: text, createdAt: z.iso.datetime(),
  status: z.enum(['draft', 'verified', 'preferred', 'superseded', 'quarantined']),
  verification: evidenceSchema.optional(), benefit: benefitEvidenceSchema.optional(),
}).strict();
const stateSchema = z.object({
  version: z.literal(1), outcomes: z.array(outcomeSchema), jobs: z.array(jobSchema),
  candidates: z.array(candidateSchema), plans: z.array(benefitPlanSchema), exclusions: z.array(text),
  contracts: z.array(acceptanceContractSchema),
}).strict();

export type PinnedSkillReference = z.infer<typeof referenceSchema>;
export type SkillOutcomeInput = z.infer<typeof outcomeInputSchema>;
export type SkillCheckEvidence = z.infer<typeof evidenceSchema>;
export type SkillAcceptanceContract = z.infer<typeof acceptanceContractSchema>;
export type SkillAcceptanceContractInput = Omit<SkillAcceptanceContract, 'registeredAt'>;
export type SkillOutcomeRecord = z.infer<typeof outcomeSchema>;
export type SkillLearningJob = z.infer<typeof jobSchema>;
export type SkillLearningIntent = z.infer<typeof learningIntentSchema>;
export type LearnedSkillCandidate = z.infer<typeof candidateSchema>;
export type SkillBenefitPlan = z.infer<typeof benefitPlanSchema>;
export type SkillBenefitEvidence = z.infer<typeof benefitEvidenceSchema>;
export type SkillLearningState = z.infer<typeof stateSchema>;
export interface SkillDraftProposal { files: ReadonlyMap<string, Uint8Array> }
export interface SkillSourceSnapshot { reference: PinnedSkillReference; files: ReadonlyMap<string, Uint8Array> }
export interface SkillLearningStoreOptions {
  maxJobs?: number; maxOutcomes?: number; maxCandidates?: number; maxAttempts?: number;
  maxPackageBytes?: number; maxPackageFiles?: number; leaseMs?: number; now?: () => number;
}

function hash(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
export function createSkillLearningJobId(outcome: Pick<SkillOutcomeInput, 'id' | 'source'>, extractorVersion: string): string {
  return hash(JSON.stringify([outcome.id, outcome.source ?? null, extractorVersion]));
}
function identity(reference: SkillReference, scope: string): string {
  return hash(JSON.stringify([scope, reference.authority, reference.packageId]));
}
function matches(reference: SkillReference | undefined, target: SkillReference, scope: string, targetScope: string): boolean {
  return scope === targetScope && reference?.authority === target.authority && reference?.packageId === target.packageId;
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
  }
}
function safeResource(resource: string): boolean {
  return resource.length > 0 && resource.length <= 512 && !resource.includes('\\') && !resource.includes('\0')
    && !path.posix.isAbsolute(resource) && resource.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export class SkillLearningConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'SkillLearningConflictError'; }
}

export class SkillLearningStore {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly candidatesDirectory: string;
  private readonly archive: SkillRevisionStore;
  private readonly now: () => number;
  private readonly limits: Required<Omit<SkillLearningStoreOptions, 'now'>>;

  constructor(readonly directory: string, options: SkillLearningStoreOptions = {}) {
    this.statePath = path.join(directory, 'learning.json');
    this.lockPath = path.join(directory, '.learning.lock');
    this.candidatesDirectory = path.join(directory, 'candidates');
    this.archive = new SkillRevisionStore(path.join(directory, 'revisions'));
    this.now = options.now ?? Date.now;
    this.limits = { maxJobs: options.maxJobs ?? 100, maxOutcomes: options.maxOutcomes ?? 1_000,
      maxCandidates: options.maxCandidates ?? 100, maxAttempts: options.maxAttempts ?? 3,
      maxPackageBytes: options.maxPackageBytes ?? 1_048_576, maxPackageFiles: options.maxPackageFiles ?? 128,
      leaseMs: options.leaseMs ?? 300_000 };
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error('Learning store limits must be positive safe integers');
    }
  }

  async snapshot(): Promise<SkillLearningState> { return this.lock(() => this.readState()); }

  async registerAcceptanceContract(input: SkillAcceptanceContractInput): Promise<SkillAcceptanceContract> {
    return this.mutate(state => {
      const previous = state.contracts.find(value => value.id === input.id);
      const parsed = acceptanceContractSchema.parse({ ...input, registeredAt: previous?.registeredAt ?? new Date(this.now()).toISOString() });
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(parsed)) throw new SkillLearningConflictError('Frozen acceptance contract cannot change');
        return previous;
      }
      if (state.contracts.length >= this.limits.maxOutcomes) throw new Error('Acceptance contract capacity reached');
      state.contracts.push(parsed);
      return parsed;
    });
  }

  async commitOutcome(input: SkillOutcomeInput, verification?: SkillCheckEvidence, intent?: SkillLearningIntent): Promise<SkillOutcomeRecord> {
    const parsed = outcomeInputSchema.parse(input);
    return this.mutate(state => {
      if (state.exclusions.includes(this.outcomeTombstone(parsed.id, parsed.scope))) throw new SkillLearningConflictError('Learning outcome evidence was deleted');
      const existing = state.outcomes.find(value => value.id === parsed.id);
      if (existing) {
        const previous: SkillOutcomeInput = { id: existing.id, taskId: existing.taskId, scope: existing.scope,
          kind: existing.kind, source: existing.source, evidenceRefs: existing.evidenceRefs, acceptanceContractId: existing.acceptanceContractId };
        if (existing.taskContext) previous.taskContext = existing.taskContext;
        if (JSON.stringify(previous) !== JSON.stringify(parsed)) throw new SkillLearningConflictError('Outcome identity already has different evidence');
        if (intent?.mode === 'explicit') existing.pendingLearning = learningIntentSchema.parse(intent);
        return existing;
      }
      if (state.outcomes.length >= this.limits.maxOutcomes) throw new Error('Learning outcome capacity reached');
      const record = outcomeSchema.parse({ ...parsed, recordedAt: new Date(this.now()).toISOString(), verification, jobKeys: [], pendingLearning: intent });
      state.outcomes.push(record);
      return record;
    });
  }

  async enqueue(outcomeId: string, options: Pick<SkillLearningJob, 'extractorVersion' | 'mode' | 'provider' | 'policyEpoch'>): Promise<SkillLearningJob | null> {
    return this.mutate(state => {
      const outcome = state.outcomes.find(value => value.id === outcomeId);
      if (!outcome) throw new Error('Commit task outcome before scheduling learning');
      if (options.mode === 'automatic' && (outcome.verification?.provenance !== 'independent-host' || !outcome.verification.passed)) throw new Error('Automatic learning requires independent outcome evidence');
      if (outcome.source && state.exclusions.includes(identity(outcome.source, outcome.scope))) return null;
      const id = createSkillLearningJobId(outcome, options.extractorVersion);
      if (state.exclusions.includes(`job:${id}`)) return null;
      const existing = state.jobs.find(job => job.id === id);
      if (existing) return existing;
      if (outcome.jobKeys.includes(id)) return null;
      if (outcome.jobKeys.length >= 16) throw new Error('Outcome extractor-version capacity reached');
      while (state.jobs.length >= this.limits.maxJobs) {
        const index = state.jobs.findIndex(job => job.state === 'published' || job.state === 'cancelled'
          || (job.state === 'failed' && job.attempts >= this.limits.maxAttempts));
        if (index < 0) return null;
        state.jobs.splice(index, 1);
      }
      const job = jobSchema.parse({ ...options, id, outcomeId, scope: outcome.scope, source: outcome.source,
        state: 'queued', attempts: 0, createdAt: new Date(this.now()).toISOString() });
      state.jobs.push(job);
      outcome.jobKeys.push(id);
      return job;
    });
  }

  async claimNext(excludedIds: ReadonlySet<string> = new Set()): Promise<SkillLearningJob | null> {
    return this.mutate(state => {
      const job = state.jobs.find(value => !excludedIds.has(value.id) && (value.state === 'queued'
        || (value.state === 'failed' && value.attempts < this.limits.maxAttempts)
        || (value.state === 'running' && value.lease && (value.lease.expiresAt <= this.now() || !processAlive(value.lease.pid)))));
      if (!job) return null;
      job.recoveryOnly = job.state === 'running' && job.attempts >= this.limits.maxAttempts;
      job.state = 'running';
      if (!job.recoveryOnly) job.attempts += 1;
      job.error = undefined;
      job.lease = { owner: crypto.randomUUID(), pid: process.pid, expiresAt: this.now() + this.limits.leaseMs };
      return job;
    });
  }

  async finishJob(job: SkillLearningJob, state: 'failed' | 'cancelled', error?: string): Promise<void> {
    await this.mutate(current => {
      const stored = this.ownedJob(current, job);
      stored.state = state;
      stored.error = error?.slice(0, 512);
      stored.lease = undefined;
    });
  }

  async archiveSource(source: SkillSourceSnapshot): Promise<void> {
    const files = this.validateFiles(source.files);
    const manifest = createSkillRevisionManifest(files);
    if (computeSkillRevision(manifest) !== source.reference.revision) throw new SkillLearningConflictError('Source revision changed');
    await this.archive.publish({ reference: source.reference, manifest, files });
  }

  async recoverPublished(job: SkillLearningJob): Promise<LearnedSkillCandidate | null> {
    return this.mutate(async state => {
      this.ownedJob(state, job);
      await this.ensureSafeCandidatesDirectory();
      const metadataPath = path.join(this.candidatesDirectory, this.candidateId(job), 'candidate.json');
      if (!await fs.pathExists(metadataPath)) return null;
      const container = await nodeFs.lstat(path.dirname(metadataPath));
      const metadataStat = await nodeFs.lstat(metadataPath);
      if (!container.isDirectory() || container.isSymbolicLink() || !metadataStat.isFile() || metadataStat.size > 65_536) throw new SkillLearningConflictError('Unsafe candidate metadata');
      const candidate = candidateSchema.parse(await fs.readJson(metadataPath));
      if (candidate.jobId !== job.id || candidate.outcomeId !== job.outcomeId || candidate.scope !== job.scope
        || candidate.id !== this.candidateId(job) || candidate.reference.packageId !== candidate.id
        || candidate.reference.authority !== `autohand-local:${job.scope}`
        || JSON.stringify(candidate.parent ?? null) !== JSON.stringify(job.source ?? null)
        || candidate.status !== 'draft' || candidate.verification || candidate.benefit) throw new SkillLearningConflictError('Published candidate lineage conflict');
      await this.assertCandidateUnchanged(candidate);
      return this.completePublication(state, job, candidate);
    });
  }

  async publishDraft(job: SkillLearningJob, proposal: SkillDraftProposal, assertCurrent: () => Promise<void>): Promise<LearnedSkillCandidate> {
    const files = this.validateFiles(proposal.files);
    const parsed = new SkillParser().parseContent(Buffer.from(files.get('SKILL.md')!).toString('utf8'), 'SKILL.md', 'autohand-project');
    if (!parsed.success) throw new Error(`Invalid learned skill package: ${parsed.error}`);
    const manifest = createSkillRevisionManifest(files);
    const revision = computeSkillRevision(manifest);
    const id = this.candidateId(job);
    const reference = { authority: `autohand-local:${job.scope}`, packageId: id, revision };
    await this.archive.publish({ reference, manifest, files });
    return this.mutate(async state => {
      this.ownedJob(state, job);
      await this.ensureSafeCandidatesDirectory();
      if (state.candidates.length >= this.limits.maxCandidates) throw new Error('Learning candidate capacity reached');
      if (job.source && state.exclusions.includes(identity(job.source, job.scope))) throw new SkillLearningConflictError('Source skill is excluded');
      const destination = path.join(this.candidatesDirectory, id);
      if (await fs.pathExists(destination)) throw new SkillLearningConflictError('Candidate destination already exists; retry recovery');
      const candidate = candidateSchema.parse({ id, jobId: job.id, outcomeId: job.outcomeId, scope: job.scope,
        reference, parent: job.source, packagePath: path.join(destination, 'package'),
        status: 'draft', createdAt: new Date(this.now()).toISOString() });
      const stage = path.join(this.candidatesDirectory, `.stage-${id}-${crypto.randomUUID()}`);
      await fs.ensureDir(stage);
      try {
        for (const [resource, content] of files) {
          const resourcePath = path.join(stage, 'package', resource);
          await fs.ensureDir(path.dirname(resourcePath));
          await atomicWriteFile(resourcePath, content);
        }
        await atomicWriteJson(path.join(stage, 'candidate.json'), candidate);
        await assertCurrent();
        await nodeFs.rename(stage, destination);
        await this.syncCandidatesDirectory();
        return this.completePublication(state, job, candidate);
      } finally {
        await fs.remove(stage);
      }
    });
  }

  async getCandidate(id: string): Promise<LearnedSkillCandidate> {
    const candidate = (await this.snapshot()).candidates.find(value => value.id === id);
    if (!candidate) throw new Error('Learned skill candidate not found');
    await this.assertCandidateUnchanged(candidate);
    return candidate;
  }

  async updateCandidate(id: string, expectedRevision: string, update: Pick<LearnedSkillCandidate, 'status'> & Partial<Pick<LearnedSkillCandidate, 'verification' | 'benefit'>>): Promise<LearnedSkillCandidate> {
    return this.mutate(async state => {
      const candidate = state.candidates.find(value => value.id === id);
      if (!candidate || candidate.reference.revision !== expectedRevision) throw new SkillLearningConflictError('Candidate revision conflict');
      await this.assertCandidateUnchanged(candidate);
      if (candidate.status === 'quarantined' || candidate.status === 'superseded') throw new SkillLearningConflictError('Candidate is no longer eligible');
      Object.assign(candidate, update);
      candidateSchema.parse(candidate);
      return candidate;
    });
  }

  async declareBenefitPlan(plan: SkillBenefitPlan): Promise<SkillBenefitPlan> {
    const parsed = benefitPlanSchema.parse(plan);
    return this.mutate(state => {
      const existing = state.plans.find(value => value.id === parsed.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw new SkillLearningConflictError('Predeclared benefit plan cannot change');
        return existing;
      }
      if (state.plans.length >= this.limits.maxCandidates) throw new Error('Benefit-plan capacity reached');
      state.plans.push(parsed);
      return parsed;
    });
  }

  async exclude(reference: SkillReference, scope: string, removeEvidence = false): Promise<void> {
    await this.mutate(state => {
      const key = identity(reference, scope);
      this.addExclusion(state, key);
      const affected = state.candidates.filter(candidate => matches(candidate.reference, reference, candidate.scope, scope)
        || matches(candidate.parent, reference, candidate.scope, scope));
      const candidateIds = new Set(affected.map(candidate => candidate.id));
      const outcomeIds = new Set(affected.map(candidate => candidate.outcomeId));
      for (const outcome of state.outcomes) if (matches(outcome.source, reference, outcome.scope, scope)) outcomeIds.add(outcome.id);
      for (const job of state.jobs) if (outcomeIds.has(job.outcomeId)) this.addExclusion(state, `job:${job.id}`);
      state.jobs = state.jobs.filter(job => !outcomeIds.has(job.outcomeId));
      state.plans = state.plans.filter(plan => !candidateIds.has(plan.candidateId));
      for (const candidate of affected) { candidate.status = 'quarantined'; candidate.verification = undefined; candidate.benefit = undefined; }
      if (removeEvidence) {
        for (const outcomeId of outcomeIds) this.addExclusion(state, this.outcomeTombstone(outcomeId, scope));
        state.candidates = state.candidates.filter(candidate => !candidateIds.has(candidate.id));
        const contractIds = new Set(state.outcomes.filter(outcome => outcomeIds.has(outcome.id)).map(outcome => outcome.acceptanceContractId));
        state.contracts = state.contracts.filter(contract => !contractIds.has(contract.id));
        state.outcomes = state.outcomes.filter(outcome => !outcomeIds.has(outcome.id));
      }
    });
  }

  private candidateId(job: SkillLearningJob): string { return `learned-${job.id.slice(0, 24)}`; }
  private outcomeTombstone(id: string, scope: string): string { return `outcome:${hash(JSON.stringify([scope, id]))}`; }
  private addExclusion(state: SkillLearningState, key: string): void {
    if (state.exclusions.includes(key)) return;
    if (state.exclusions.length >= this.limits.maxOutcomes * 3 + this.limits.maxJobs) throw new Error('Skill exclusion capacity reached');
    state.exclusions.push(key);
  }
  private async ensureSafeCandidatesDirectory(): Promise<void> {
    await fs.ensureDir(this.candidatesDirectory);
    for (const directory of [this.directory, this.candidatesDirectory]) {
      const stat = await nodeFs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillLearningConflictError('Unsafe symbolic learning directory');
    }
  }
  private async syncCandidatesDirectory(): Promise<void> {
    let directory: Awaited<ReturnType<typeof nodeFs.open>> | undefined;
    try {
      directory = await nodeFs.open(this.candidatesDirectory, 'r');
      await directory.sync();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(code)) throw error;
    } finally { await directory?.close(); }
  }
  private validateFiles(input: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
    if (input.size === 0 || input.size > this.limits.maxPackageFiles || !input.has('SKILL.md')) throw new Error('Learning package requires SKILL.md within file limits');
    let bytes = 0;
    const files = new Map<string, Uint8Array>();
    for (const [resource, content] of input) {
      if (!safeResource(resource) || !(content instanceof Uint8Array)) throw new Error('Unsafe learning package resource');
      bytes += content.byteLength;
      if (bytes > this.limits.maxPackageBytes) throw new Error('Learning package byte limit exceeded');
      files.set(resource, Uint8Array.from(content));
    }
    return files;
  }
  private async assertCandidateUnchanged(candidate: LearnedSkillCandidate): Promise<void> {
    const expectedPath = path.join(this.candidatesDirectory, candidate.id, 'package');
    if (!/^learned-[a-f0-9]{24}$/.test(candidate.id) || candidate.packagePath !== expectedPath) throw new SkillLearningConflictError('Unsafe candidate package path');
    await this.ensureSafeCandidatesDirectory();
    const container = await nodeFs.lstat(path.dirname(expectedPath));
    if (!container.isDirectory() || container.isSymbolicLink()) throw new SkillLearningConflictError('Candidate parent changed to a symbolic link');
    const files = new Map<string, Uint8Array>();
    let resourceCount = 0;
    let bytes = 0;
    const walk = async (directory: string, prefix: string): Promise<void> => {
      if ((await nodeFs.lstat(directory)).isSymbolicLink()) throw new SkillLearningConflictError('Candidate package changed to a symbolic link');
      for (const entry of await nodeFs.readdir(directory, { withFileTypes: true })) {
        resourceCount += 1;
        if (resourceCount > this.limits.maxPackageFiles * 4 || prefix.split('/').length > 16) throw new SkillLearningConflictError('Candidate resource limit changed');
        const resource = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new SkillLearningConflictError('Candidate resource changed');
        if (entry.isDirectory()) await walk(fullPath, resource);
        else {
          if (files.size >= this.limits.maxPackageFiles) throw new SkillLearningConflictError('Candidate resource limit changed');
          const stat = await nodeFs.lstat(fullPath);
          bytes += stat.size;
          if (bytes > this.limits.maxPackageBytes) throw new SkillLearningConflictError('Candidate resource limit changed');
          files.set(resource, await nodeFs.readFile(fullPath));
        }
      }
    };
    await walk(expectedPath, '');
    const revision = computeSkillRevision(createSkillRevisionManifest(this.validateFiles(files)));
    if (revision !== candidate.reference.revision) throw new SkillLearningConflictError('Candidate package changed; preserve user edits and create a new revision');
  }
  private ownedJob(state: SkillLearningState, job: SkillLearningJob): SkillLearningJob {
    const stored = state.jobs.find(value => value.id === job.id);
    if (!stored || stored.state !== 'running' || !stored.lease || stored.lease.owner !== job.lease?.owner
      || stored.lease.expiresAt <= this.now()) throw new SkillLearningConflictError('Learning job lease conflict');
    return stored;
  }
  private completePublication(state: SkillLearningState, job: SkillLearningJob, candidate: LearnedSkillCandidate): LearnedSkillCandidate {
    const stored = this.ownedJob(state, job);
    if (state.exclusions.includes(identity(candidate.reference, candidate.scope))
      || state.exclusions.includes(`job:${job.id}`)) throw new SkillLearningConflictError('Published learning candidate was excluded');
    if (!state.candidates.some(value => value.id === candidate.id)) state.candidates.push(candidate);
    stored.state = 'published'; stored.candidateId = candidate.id; stored.lease = undefined;
    return state.candidates.find(value => value.id === candidate.id)!;
  }
  private async readState(): Promise<SkillLearningState> {
    if (!await fs.pathExists(this.statePath)) return { version: 1, outcomes: [], jobs: [], candidates: [], plans: [], exclusions: [], contracts: [] };
    const stat = await nodeFs.lstat(this.statePath);
    if (!stat.isFile() || stat.size > 16_777_216) throw new Error('Unsafe or oversized skill learning state');
    return stateSchema.parse(await fs.readJson(this.statePath));
  }
  private async mutate<T>(operation: (state: SkillLearningState) => T | Promise<T>): Promise<T> {
    return this.lock(async () => {
      const state = await this.readState();
      const result = await operation(state);
      await atomicWriteJson(this.statePath, stateSchema.parse(state));
      return structuredClone(result);
    });
  }
  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    await fs.ensureDir(this.directory);
    return withFileLock(this.lockPath, operation, { staleMs: 30_000, waitTimeoutMs: 5_000, retryDelayMs: 10 });
  }
}
