import type { SkillReference } from '../skills/SkillRuntime.js';
import type { GoalCheckpoint, GoalState } from './types.js';

export type PinnedSkillReference = SkillReference & { revision: string };
export interface GoalEffectObservation {
  status: 'absent' | 'completed' | 'unknown';
  evidence: string;
  observedAt: number;
}
export interface GoalPendingEffect {
  id: string;
  description: string;
  status: 'pending' | 'unknown' | 'observed';
  observation?: GoalEffectObservation;
}
export interface GoalContinuity {
  version: 1;
  approvedIntent: string;
  workspaceId: string;
  skills: PinnedSkillReference[];
  checkReferences: string[];
  pendingEffects: GoalPendingEffect[];
  freshness: {
    runtimeVersion: string;
    providerId: string;
    permissionEpoch: string;
    capturedAt: number;
    maxAgeMs?: number;
  };
}
export interface GoalContinuityContext {
  workspaceId: string;
  runtimeVersion: string;
  providerId: string;
  permissionEpoch: string;
  checkedAt: number;
  resolveSkill(reference: PinnedSkillReference): Promise<SkillReference | null>;
  observeEffect?(effect: GoalPendingEffect): Promise<GoalEffectObservation>;
}
export type GoalContinuityResolver = (goal: GoalState) => Promise<GoalContinuityContext>;
export interface GoalRuntimeContinuity {
  prepareTurnContext?(): Promise<void>;
  assertTaskPins?(references: readonly PinnedSkillReference[]): Promise<void>;
  resolveContext: GoalContinuityResolver;
  getPinnedReferences(): readonly PinnedSkillReference[];
}
export function goalManagerContinuityOptions(adapter?: GoalRuntimeContinuity): {
  resolveContinuityContext?: GoalContinuityResolver;
  getPinnedReferences?: () => readonly PinnedSkillReference[];
} {
  return { resolveContinuityContext: adapter?.resolveContext, getPinnedReferences: adapter?.getPinnedReferences };
}

export async function captureSubmittedGoalSkills(goal: GoalState, checkpoint: GoalCheckpoint, resolver: GoalContinuityResolver | undefined,
  getPinnedReferences: (() => readonly PinnedSkillReference[]) | undefined): Promise<GoalCheckpoint> {
  if (!getPinnedReferences) return checkpoint;
  const submitted = getPinnedReferences().map(parsePinnedSkill);
  const previous = checkpoint.continuity;
  if (!submitted.length && !previous) return checkpoint;
  if (!resolver) throw new TypeError('Cannot checkpoint submitted skill pins: current context validation is unavailable.');
  const context = await resolver({ ...goal, checkpoint });
  const now = Date.now();
  if (!Number.isFinite(context.checkedAt) || context.checkedAt > now || now - context.checkedAt > 60_000) throw new TypeError('Cannot checkpoint: current context attestation is stale or invalid.');
  const skills = [...(previous?.skills ?? [])];
  for (const reference of submitted) {
    const existing = skills.find(pin => pin.authority === reference.authority && pin.packageId === reference.packageId && pin.resource === reference.resource);
    if (existing && existing.revision !== reference.revision) throw new TypeError(`Cannot silently replace pinned revision ${existing.revision}. Choose an explicit skill upgrade before checkpointing.`);
    if (!existing) skills.push(reference);
  }
  if (previous) {
    for (const key of ['workspaceId', 'runtimeVersion', 'providerId', 'permissionEpoch'] as const) {
      if (context[key] !== (key === 'workspaceId' ? previous.workspaceId : previous.freshness[key])) throw new TypeError(`Cannot checkpoint: ${key} changed; explicitly revalidate the checkpoint under the current context.`);
    }
  }
  const continuity = parseGoalContinuity({ version: 1,
    approvedIntent: previous?.approvedIntent ?? (goal.objective.length <= 4000 ? goal.objective : `The approved objective is retained in goal ${goal.goalId}.`),
    workspaceId: context.workspaceId, skills, checkReferences: previous?.checkReferences ?? [], pendingEffects: previous?.pendingEffects ?? [],
    freshness: { runtimeVersion: context.runtimeVersion, providerId: context.providerId, permissionEpoch: context.permissionEpoch,
      capturedAt: context.checkedAt, ...(previous?.freshness.maxAgeMs ? { maxAgeMs: previous.freshness.maxAgeMs } : {}) } });
  return { ...checkpoint, continuity };
}

export const MAX_CHECKPOINT_HISTORY = 128;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;

export function parseGoalContinuity(value: unknown): GoalContinuity | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (raw.version !== 1) throw new TypeError('Unsupported goal continuity version.');
  const freshness = record(raw.freshness);
  return { version: 1, approvedIntent: text(raw.approvedIntent, 'approved intent'), workspaceId: text(raw.workspaceId, 'workspace identity'),
    skills: items(raw.skills, 'skill pins').map(parsePinnedSkill), checkReferences: items(raw.checkReferences, 'check references').map(value => text(value, 'check reference')),
    pendingEffects: items(raw.pendingEffects, 'pending effects').map(parseEffect),
    freshness: { runtimeVersion: text(freshness.runtimeVersion, 'runtime version'), providerId: text(freshness.providerId, 'provider identity'),
      permissionEpoch: text(freshness.permissionEpoch, 'permission epoch'), capturedAt: timestamp(freshness.capturedAt),
      ...(freshness.maxAgeMs === undefined ? {} : { maxAgeMs: positive(freshness.maxAgeMs) }) } };
}

export function parsePinnedSkill(value: unknown): PinnedSkillReference {
  const raw = record(value);
  const resource = raw.resource === undefined ? 'SKILL.md' : text(raw.resource, 'skill resource');
  if (resource && (resource.startsWith('/') || /^[a-z]:/i.test(resource) || resource.includes('\0') || resource.includes('\\') || resource.split('/').some(part => part === '..' || part === '.'))) {
    throw new TypeError('Skill resource must be a contained package-relative path.');
  }
  return { authority: text(raw.authority, 'skill authority'), packageId: text(raw.packageId, 'skill package ID'), revision: text(raw.revision, 'exact skill revision'),
    ...(resource ? { resource } : {}) };
}

function parseEffect(value: unknown): GoalPendingEffect {
  const raw = record(value);
  if (raw.status !== 'pending' && raw.status !== 'unknown' && raw.status !== 'observed') throw new TypeError('Invalid pending effect status.');
  const observation = raw.observation === undefined ? undefined : parseObservation(raw.observation);
  if (raw.status === 'observed' && (!observation || observation.status === 'unknown')) throw new TypeError('Observed effects require conclusive external evidence.');
  if (raw.status !== 'observed' && observation) throw new TypeError('Only observed effects can contain an observation.');
  return { id: text(raw.id, 'effect ID'), description: text(raw.description, 'effect description'), status: raw.status, ...(observation ? { observation } : {}) };
}
function parseObservation(value: unknown): GoalEffectObservation {
  const raw = record(value);
  if (raw.status !== 'absent' && raw.status !== 'completed' && raw.status !== 'unknown') throw new TypeError('Invalid external effect observation.');
  return { status: raw.status, evidence: text(raw.evidence, 'observation evidence'), observedAt: timestamp(raw.observedAt) };
}

export function retainCheckpointHistory(history: GoalCheckpoint[] | undefined, current: GoalCheckpoint | undefined, replacement: GoalCheckpoint | undefined): GoalCheckpoint[] | undefined {
  if (!current?.continuity || continuitySignature(current.continuity) === continuitySignature(replacement?.continuity)) return history;
  if ((history?.length ?? 0) >= MAX_CHECKPOINT_HISTORY) throw new TypeError('Goal checkpoint history limit reached. Preserve this goal before creating more checkpoints.');
  return [...(history ?? []), structuredClone(current)];
}

export function preserveUnknownEffects(previous: GoalContinuity | undefined, next: GoalContinuity | undefined): void {
  for (const effect of previous?.pendingEffects ?? []) {
    if (effect.status !== 'unknown') continue;
    const retained = next?.pendingEffects.find(item => item.id === effect.id);
    if (!retained || JSON.stringify(retained) !== JSON.stringify(effect)) {
      throw new TypeError(`Cannot discard uncertain external effect ${effect.id}; observe it before retrying or replacing the checkpoint.`);
    }
  }
}

export async function preflightGoalContinuity(goal: GoalState, resolver?: GoalContinuityResolver): Promise<GoalCheckpoint | undefined> {
  const checkpoint = goal.checkpoint;
  const continuity = checkpoint?.continuity;
  if (!checkpoint || !continuity) return checkpoint;
  if (!resolver) throw new TypeError('Cannot resume: current context validation is unavailable for this checkpoint.');
  const context = await resolver(structuredClone(goal));
  const now = Date.now();
  const ageLimit = continuity.freshness.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(context.checkedAt) || context.checkedAt > now || now - context.checkedAt > 60_000) throw new TypeError('Cannot resume: current context attestation is stale or invalid.');
  if (continuity.freshness.capturedAt > now || now - continuity.freshness.capturedAt > ageLimit) throw new TypeError('Cannot resume: checkpoint is stale; explicitly revalidate it before continuing.');
  for (const key of ['workspaceId', 'runtimeVersion', 'providerId', 'permissionEpoch'] as const) {
    const previous = key === 'workspaceId' ? continuity.workspaceId : continuity.freshness[key];
    if (!context[key] || context[key] !== previous) throw new TypeError(`Cannot resume: ${key} changed; explicitly revalidate the checkpoint under the current context.`);
  }
  for (const reference of continuity.skills) {
    const resolved = await context.resolveSkill({ ...reference });
    if (!resolved || resolved.authority !== reference.authority || resolved.packageId !== reference.packageId || resolved.revision !== reference.revision || resolved.resource !== reference.resource) {
      throw new TypeError(`Cannot resume: pinned skill revision unavailable: ${reference.authority}/${reference.packageId}@${reference.revision}${reference.resource ? `#${reference.resource}` : ''}. Choose an explicit replacement; aliases are not substituted.`);
    }
  }
  const next = structuredClone(checkpoint);
  for (const effect of next.continuity!.pendingEffects) {
    if (effect.status !== 'unknown') continue;
    if (!context.observeEffect) throw new TypeError(`Cannot resume: observe uncertain external effect ${effect.id} before retrying.`);
    const observation = parseObservation(await context.observeEffect(structuredClone(effect)));
    if (observation.status === 'unknown' || observation.observedAt > Date.now() || observation.observedAt < context.checkedAt) {
      throw new TypeError(`Cannot resume: external effect ${effect.id} remains uncertain; observe it before retrying.`);
    }
    effect.status = 'observed'; effect.observation = observation;
  }
  return next;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Goal continuity must be an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new TypeError(`${name} must contain at most 4000 non-empty characters.`);
  return value.trim();
}
function items(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError(`${name} must contain at most 32 entries.`);
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('Continuity timestamps must be non-negative numbers.');
  return value;
}
function positive(value: unknown): number {
  const result = timestamp(value);
  if (!result) throw new TypeError('Freshness maxAgeMs must be positive.');
  return result;
}

function continuitySignature(continuity: GoalContinuity | undefined): string | undefined {
  return JSON.stringify(continuity && { ...continuity, freshness: { ...continuity.freshness, capturedAt: undefined } });
}
