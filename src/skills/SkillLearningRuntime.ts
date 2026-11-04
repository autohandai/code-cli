import crypto from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SkillLearningCoordinator, type SkillLearningCoordinatorOptions } from './SkillLearningCoordinator.js';
import { SkillLearningStore, type LearnedSkillCandidate, type PinnedSkillReference, type SkillAcceptanceContract,
  type SkillCheckEvidence, type SkillDraftProposal, type SkillLearningJob, type SkillOutcomeInput,
  type SkillOutcomeRecord, type SkillSourceSnapshot } from './SkillLearningStore.js';
import { ensureSkillWorkspaceIdentity } from './workspaceIdentity.js';
import { formatSkillReference, type SkillReference } from './SkillRuntime.js';
import { setBounded } from '../utils/bounded.js';

const boundedText = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const checkSchema = z.object({ id: boundedText, command: z.array(boundedText).min(1).max(32),
  files: z.array(boundedText).min(1).max(16), cwd: boundedText.optional(), timeoutMs: z.number().int().positive().max(300_000).optional() }).strict();
const verificationSchema = z.object({ id: boundedText, inputIds: z.array(boundedText).min(1).max(16),
  checks: z.array(checkSchema).min(1).max(8), artifacts: z.array(boundedText).min(1).max(16) }).strict();
const candidateSchema = verificationSchema.omit({ artifacts: true });
export type SkillLearningCheck = z.infer<typeof checkSchema>;
export interface SkillLearningSettings {
  enabled?: boolean;
  scope?: 'project' | 'user';
  verification?: z.infer<typeof verificationSchema>;
  candidateVerification?: z.infer<typeof candidateSchema>;
}
export interface SkillLearningCheckResult { executed: boolean; exitCode: number | null; outputDigest?: string }
export interface SkillLearningExtractionContext {
  job: SkillLearningJob;
  outcome: SkillOutcomeRecord;
  instruction: string;
  answer: string;
  source?: SkillSourceSnapshot;
}
export interface SkillLearningRuntimeOptions {
  directory: string;
  getSettings(): SkillLearningSettings;
  getWorkspace(): string;
  getTaskId(): string;
  getSource(reference: PinnedSkillReference, scope: string): Promise<SkillSourceSnapshot | null>;
  getLastAnswer(): string;
  getActivePins(): readonly SkillReference[];
  policy: SkillLearningCoordinatorOptions['policy'];
  runCheck?(check: SkillLearningCheck, signal: AbortSignal): Promise<SkillLearningCheckResult>;
  extract(context: SkillLearningExtractionContext, signal: AbortSignal): Promise<SkillDraftProposal>;
  onCatalogChanged?(candidates: LearnedSkillCandidate[]): Promise<void> | void;
  benefit?: SkillLearningCoordinatorOptions['benefit'];
  now?: () => number;
}
interface FrozenChecks {
  config: z.infer<typeof candidateSchema> & { artifacts?: string[] };
  revision: string;
  workspace: string;
  scope: string;
}
interface LearningTurn {
  taskId: string; instructionHash: string; workspace: string; scope: string;
  before: Map<string, string>; contract?: SkillAcceptanceContract;
}
function hash(value: string | Uint8Array): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function greeting(value: string): boolean { return /^(?:hi|hello|hey|thanks|thank you|ok|okay|bye|good (?:morning|afternoon|evening))[.!\s]*$/i.test(value.trim()); }
function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export class SkillLearningRuntime {
  readonly coordinator: SkillLearningCoordinator;
  private readonly turns = new Map<string, LearningTurn>();
  private readonly attestations = new Map<string, SkillCheckEvidence>();
  private readonly now: () => number;

  private constructor(private readonly options: SkillLearningRuntimeOptions, private readonly store: SkillLearningStore,
    private readonly projectScope: string, private readonly frozenSource?: FrozenChecks, private readonly frozenCandidate?: FrozenChecks) {
    this.now = options.now ?? Date.now;
    this.coordinator = new SkillLearningCoordinator({ store, extractorVersion: 'autohand-skill-extractor-v1', now: this.now,
      policy: async context => {
        const policy = await options.policy(context);
        return { ...policy, automaticLearning: options.getSettings().enabled === true && policy.automaticLearning !== false };
      },
      resolveSource: (reference, scope) => options.getSource(reference, scope),
      checkOutcome: async input => this.attestations.get(input.id) ?? null,
      extract: async (job, outcome, source, signal) => {
        const context = outcome.taskContext ?? { intent: '', observations: '' };
        const proposal = await options.extract({ job, outcome, source, instruction: context.intent, answer: context.observations }, signal);
        this.assertPrivateProposal(proposal, job.scope);
        return proposal;
      },
      verification: frozenCandidate ? { contractId: frozenCandidate.config.id, contractRevision: frozenCandidate.revision,
        check: async (candidate, signal) => {
          if (!await this.unchanged(frozenCandidate, 'candidate')) throw new Error('The independent candidate check contract changed');
          const passed = await this.runChecks(frozenCandidate, signal, candidate);
          if (!await this.unchanged(frozenCandidate, 'candidate')) throw new Error('The independent candidate check files changed');
          return { provenance: 'independent-host', passed, contractId: frozenCandidate.config.id, contractRevision: frozenCandidate.revision,
            candidateRevision: candidate.reference.revision, inputIds: frozenCandidate.config.inputIds,
            checkIds: frozenCandidate.config.checks.map(check => check.id), artifactIds: [],
            environmentId: `workspace:${projectScope}`, observedAt: new Date(this.now()).toISOString() };
        } } : undefined,
      benefit: options.benefit,
    });
  }

  static async create(options: SkillLearningRuntimeOptions): Promise<SkillLearningRuntime> {
    const workspace = path.resolve(options.getWorkspace());
    const projectScope = `project:${await ensureSkillWorkspaceIdentity(workspace)}`;
    const scope = options.getSettings().scope === 'user' ? 'user' : projectScope;
    const store = new SkillLearningStore(options.directory, { now: options.now });
    const freeze = async (kind: 'source' | 'candidate'): Promise<FrozenChecks | undefined> => {
      try {
        const raw = kind === 'source' ? options.getSettings().verification : options.getSettings().candidateVerification;
        if (!raw) return undefined;
        const config = kind === 'source' ? verificationSchema.parse(raw) : candidateSchema.parse(raw);
        if (kind === 'candidate' && config.checks.some(check => !check.command.some(part => part.includes('{candidate}')))) return undefined;
        const revision = await this.fingerprint(workspace, config);
        await store.registerAcceptanceContract({ id: `configured:${scope}:${kind}:${config.id}`, revision, taskId: 'configured-contract', scope,
          inputIds: config.inputIds, requiredCheckIds: config.checks.map(check => check.id),
          artifactBaselines: [{ artifactId: 'independent-check-contract', digest: revision }] });
        return { config: structuredClone(config), revision, workspace, scope };
      } catch { return undefined; }
    };
    const source = await freeze('source');
    const candidate = await freeze('candidate');
    return new SkillLearningRuntime(options, store, projectScope, source, candidate);
  }

  get scope(): string { return this.options.getSettings().scope === 'user' ? 'user' : this.projectScope; }

  async begin(instruction: string, options: { taskId: string; signal: AbortSignal }): Promise<void> {
    if (options.signal.aborted) return;
    const turn: LearningTurn = { taskId: options.taskId, instructionHash: hash(instruction), workspace: path.resolve(this.options.getWorkspace()),
      scope: this.scope, before: new Map() };
    setBounded(this.turns, turn.taskId, turn, 16);
    if (greeting(instruction) || !this.frozenSource || !await this.unchanged(this.frozenSource, 'source')) return;
    try {
      for (const file of this.frozenSource.config.artifacts ?? []) turn.before.set(file, await SkillLearningRuntime.fileDigest(turn.workspace, file, true));
      if (options.signal.aborted) return;
      turn.contract = await this.coordinator.registerAcceptanceContract({ id: `task:${turn.taskId}:${this.frozenSource.config.id}`,
        revision: this.frozenSource.revision, taskId: turn.taskId, scope: turn.scope,
        inputIds: [`task-input:${turn.instructionHash}`, ...this.frozenSource.config.inputIds],
        requiredCheckIds: this.frozenSource.config.checks.map(check => check.id),
        artifactBaselines: [...turn.before].map(([file, digest]) => ({ artifactId: `artifact:${file}`, digest })) });
    } catch { turn.contract = undefined; }
  }

  async finish(result: { instruction: string; success: boolean; aborted: boolean }, signal: AbortSignal, options: { taskId?: string } = {}): Promise<void> {
    const turn = options.taskId ? this.turns.get(options.taskId)
      : this.turns.get(this.options.getTaskId()) ?? [...this.turns.values()].find(value => value.instructionHash === hash(result.instruction));
    if (!turn || turn.instructionHash !== hash(result.instruction)) return;
    this.turns.delete(turn.taskId);
    if (turn.scope !== this.scope || turn.workspace !== path.resolve(this.options.getWorkspace())) return;
    const pins = this.options.getActivePins().filter((pin): pin is PinnedSkillReference => typeof pin.revision === 'string').slice(0, 16);
    const kind = result.aborted || signal.aborted ? 'cancelled' : !result.success ? 'noop' : greeting(result.instruction) ? 'greeting' : 'work';
    const input: SkillOutcomeInput = { id: `outcome:${turn.taskId}`, taskId: turn.taskId, scope: turn.scope, kind,
      source: pins[0], acceptanceContractId: turn.contract?.id, evidenceRefs: pins.map(formatSkillReference),
      taskContext: { intent: this.sanitize(result.instruction, 1_000), observations: this.sanitize(this.options.getLastAnswer(), 3_000) } };
    const policy = await this.options.policy({ scope: turn.scope, mode: 'automatic' });
    if (kind === 'work' && this.options.getSettings().enabled === true && policy.allowed && policy.automaticLearning !== false
      && turn.contract && this.frozenSource && await this.unchanged(this.frozenSource, 'source')) {
      try {
        const witness = async () => {
          const values = [];
          for (const [file, beforeDigest] of turn.before) values.push({ artifactId: `artifact:${file}`, beforeDigest,
            afterDigest: await SkillLearningRuntime.fileDigest(turn.workspace, file, true) });
          return values;
        };
        const witnesses = await witness();
        if (witnesses.some(witness => witness.beforeDigest !== witness.afterDigest)) {
          const passed = await this.runChecks(this.frozenSource, signal);
          const checkedWitnesses = await witness();
          if (await this.unchanged(this.frozenSource, 'source') && checkedWitnesses.some(value => value.beforeDigest !== value.afterDigest)) setBounded(this.attestations, input.id, { provenance: 'independent-host', passed,
            nontrivial: true, contractId: turn.contract.id, contractRevision: turn.contract.revision,
            inputIds: turn.contract.inputIds, checkIds: turn.contract.requiredCheckIds, artifactIds: checkedWitnesses.map(value => value.artifactId),
            artifactWitnesses: checkedWitnesses, environmentId: `workspace:${this.projectScope}`, observedAt: new Date(this.now()).toISOString() }, 16);
        }
      } catch { this.attestations.delete(input.id); }
    }
    try {
      const outcome = await this.coordinator.recordOutcome(input);
      if (outcome.pendingLearning) void this.coordinator.processPending(1).then(() => this.refreshCatalog()).catch(() => {});
    } finally { this.attestations.delete(input.id); }
  }

  async latestOutcome(id?: string): Promise<SkillOutcomeInput | null> {
    const records = (await this.store.snapshot()).outcomes.filter(value => value.scope === this.scope && value.kind === 'work');
    const outcome = id ? records.find(value => value.id === id) : records.at(-1);
    if (!outcome) return null;
    return { id: outcome.id, taskId: outcome.taskId, scope: outcome.scope, kind: outcome.kind, source: outcome.source,
      evidenceRefs: outcome.evidenceRefs, acceptanceContractId: outcome.acceptanceContractId, taskContext: outcome.taskContext };
  }
  async refreshCatalog(): Promise<void> { await this.options.onCatalogChanged?.(await this.coordinator.list(this.scope)); }

  private async runChecks(frozen: FrozenChecks, signal: AbortSignal, candidate?: LearnedSkillCandidate): Promise<boolean> {
    if (!this.options.runCheck || signal.aborted) return false;
    for (const configured of frozen.config.checks) {
      if (signal.aborted) return false;
      const check = structuredClone(configured);
      check.cwd = path.resolve(frozen.workspace, check.cwd ?? '.');
      check.command = check.command.map(part => candidate ? part.replaceAll('{candidate}', candidate.packagePath) : part);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(check.timeoutMs ?? 15_000)]);
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Independent check cancelled or timed out'));
        deadline.addEventListener('abort', onAbort, { once: true });
      });
      let result: SkillLearningCheckResult;
      try { result = await Promise.race([this.options.runCheck(check, deadline), aborted]); }
      finally { if (onAbort) deadline.removeEventListener('abort', onAbort); }
      if (!result.executed || result.exitCode !== 0 || signal.aborted) return false;
    }
    return true;
  }
  private async unchanged(frozen: FrozenChecks, kind: 'source' | 'candidate'): Promise<boolean> {
    try {
      if (this.scope !== frozen.scope || path.resolve(this.options.getWorkspace()) !== frozen.workspace) return false;
      const raw = kind === 'source' ? this.options.getSettings().verification : this.options.getSettings().candidateVerification;
      const config = kind === 'source' ? verificationSchema.parse(raw) : candidateSchema.parse(raw);
      return await SkillLearningRuntime.fingerprint(frozen.workspace, config) === frozen.revision;
    } catch { return false; }
  }
  private sanitize(value: string, maxChars: number): string {
    return value.replaceAll(this.options.getWorkspace(), '[workspace]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}|\b(?:authorization|password|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .slice(0, maxChars);
  }
  private assertPrivateProposal(proposal: SkillDraftProposal, scope: string): void {
    for (const content of proposal.files.values()) {
      const text = Buffer.from(content).toString('utf8');
      if (/\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
        || (scope === 'user' && text.includes(this.options.getWorkspace()))) throw new Error('Draft contains private source details; keep the source outcome for review');
    }
  }
  private static async fingerprint(workspace: string, config: z.infer<typeof candidateSchema> & { artifacts?: string[] }): Promise<string> {
    const fileNames = [...new Set(config.checks.flatMap(check => check.files))].sort();
    if (fileNames.length > 32 || new Set(config.checks.map(check => check.id)).size !== config.checks.length
      || new Set(config.inputIds).size !== config.inputIds.length) throw new Error('Invalid independent check identities');
    for (const check of config.checks) {
      const cwd = await fs.realpath(path.resolve(workspace, check.cwd ?? '.'));
      if (!contained(await fs.realpath(workspace), cwd)) throw new Error('Check working directory is outside the workspace');
    }
    const files = [];
    for (const file of fileNames) files.push({ file, digest: await this.fileDigest(workspace, file, false) });
    return hash(JSON.stringify({ config, files }));
  }
  private static async fileDigest(workspace: string, resource: string, allowMissing: boolean): Promise<string> {
    const filename = path.resolve(workspace, resource);
    const canonicalRoot = await fs.realpath(workspace);
    if (!contained(workspace, filename)) throw new Error('Verification resource is outside the workspace');
    try {
      const info = await fs.lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576 || !contained(canonicalRoot, await fs.realpath(filename))) throw new Error('Unsafe or oversized verification resource');
      const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (current.ino !== info.ino || current.dev !== info.dev || current.size > 1_048_576) throw new Error('Verification resource changed while opening');
        return hash(await handle.readFile());
      } finally { await handle.close(); }
    } catch (error) {
      if (allowMissing && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return hash(`missing:${path.relative(workspace, filename)}`);
      throw error;
    }
  }
}
