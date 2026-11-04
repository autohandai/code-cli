import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveBrainstormAutoInjection } from './brainstormIntent.js';
import { resolveComputerControlAutoInjection } from './computerControlIntent.js';
import { resolveDebugAutoInjection } from './debugIntent.js';
import { formatSkillReference, parseSkillReference } from './SkillRuntime.js';
import type { PreparedSkillPacket, SkillAttachmentReceipt, SkillReference, SkillSelectionReason } from './SkillRuntime.js';
import type { ExactSkillReference } from './SkillRevisionStore.js';
import type { SkillsRegistry } from './SkillsRegistry.js';
import type { SkillDefinition } from './types.js';

export type AdaptiveSkillRegistry = Pick<SkillsRegistry, 'getSkillRuntime' | 'getCatalogSkills' | 'getSkillReference'
  | 'getActivationOrigin' | 'ensureAdaptiveWorkspace' | 'activateSkill'> & {
    getActivationReference?(skill: SkillDefinition): SkillReference;
  };

export interface AdaptiveSkillCandidate {
  reference: SkillReference;
  name: string;
  description: string;
  scope: string;
  score: number;
}

export interface AdaptiveSkillSessionOptions {
  registry: AdaptiveSkillRegistry;
  adapter?: 'autohand' | 'external';
  rerank?(request: { instruction: string; candidates: readonly AdaptiveSkillCandidate[]; signal?: AbortSignal }): Promise<SkillReference | null>;
}

export interface AdaptiveSkillTaskOptions {
  automatic?: boolean;
  planModeActive?: boolean;
  taskId?: string;
  signal?: AbortSignal;
}

export interface AdaptiveSkillRequestOptions {
  maxTokens: number;
  signal?: AbortSignal;
}

export interface AdaptiveSkillAcknowledgement {
  requestId: string;
  sessionId: string;
  content: string[];
  policyEpoch: number;
  signal?: AbortSignal;
}

interface Selection {
  reference: SkillReference;
  reason: SkillSelectionReason;
  packet?: PreparedSkillPacket;
  attested: boolean;
  pendingRestore: boolean;
  allowArchived: boolean;
}

interface ActivationSnapshot {
  reference: string;
  token: SkillReference;
  suppressed: boolean;
}

const MAX_SELECTIONS = 32;
const MAX_SHORTLIST = 8;
const MIN_CONFIDENT_SCORE = 0.65;
const MIN_CONFIDENT_MARGIN = 0.15;
const MIN_RERANK_SCORE = 0.35;

function identity(reference: SkillReference): string {
  return formatSkillReference({ authority: reference.authority, packageId: reference.packageId });
}

function selectionKey(reference: SkillReference): string {
  return formatSkillReference({ authority: reference.authority, packageId: reference.packageId, resource: reference.resource ?? 'SKILL.md' });
}

function packetKey(packet: PreparedSkillPacket): string {
  return `${formatSkillReference(packet.reference)}\n${packet.contentDigest}`;
}

function clonePacket(packet: PreparedSkillPacket, taskId = packet.taskId, reason = packet.reason): PreparedSkillPacket {
  return { ...packet, taskId, reason, reference: { ...packet.reference }, resourcePaths: [...packet.resourcePaths],
    manifest: packet.manifest.map(resource => ({ ...resource })),
    dependencies: packet.dependencies.map(dependency => clonePacket(dependency, taskId, reason)) };
}

function flattenPackets(packets: readonly PreparedSkillPacket[]): PreparedSkillPacket[] {
  const flattened = new Map<string, PreparedSkillPacket>();
  const visit = (packet: PreparedSkillPacket): void => {
    if (flattened.has(packetKey(packet))) return;
    if (flattened.size >= MAX_SELECTIONS * 4) throw new Error('Skill dependencies exceed the active session budget.');
    flattened.set(packetKey(packet), packet);
    for (const dependency of packet.dependencies) visit(dependency);
  };
  packets.forEach(visit);
  return [...flattened.values()];
}

function explicitReferences(instruction: string): Array<SkillReference | string> {
  const references: Array<SkillReference | string> = [];
  const seen = new Set<string>();
  const add = (reference: SkillReference | string): void => {
    const key = typeof reference === 'string' ? reference : formatSkillReference(reference);
    if (seen.has(key)) return;
    if (references.length >= MAX_SELECTIONS) throw new Error('Explicit skill mentions exceed the selection budget.');
    seen.add(key);
    references.push(reference);
  };
  const qualified = instruction.replace(/\$?skill:\/\/[^\s<>()[\]{}'"`]+/gu, value => {
    const parsed = parseSkillReference(value.replace(/^\$/u, '').replace(/[.,;!]+$/u, ''));
    if (!parsed) throw new Error('Invalid qualified skill reference.');
    add(parsed);
    return ' ';
  });
  for (const mention of qualified.matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu)) add(mention[1]);
  return references;
}

export class AdaptiveSkillSession {
  private readonly selections = new Map<string, Selection>();
  private readonly emitted = new Set<string>();
  private readonly activations = new WeakMap<SkillDefinition, ActivationSnapshot>();
  private taskId: string | null = null;
  private automatic = true;
  private generation = 0;

  constructor(private readonly options: AdaptiveSkillSessionOptions) {}

  private currentSkill(reference: SkillReference): SkillDefinition | null {
    const entry = this.options.registry.getSkillRuntime().resolve(reference);
    if (!entry) return null;
    return this.options.registry.getCatalogSkills().find(skill => path.dirname(skill.path) === entry.root
      && identity(this.options.registry.getSkillReference(skill)) === identity(reference)) ?? null;
  }

  private select(reference: SkillReference | string, reason: SkillSelectionReason, explicit = false, activate = true,
    allowArchived = explicit && typeof reference !== 'string' && reference.revision !== undefined): boolean {
    const runtime = this.options.registry.getSkillRuntime();
    const entry = runtime.resolve(reference);
    if (!entry) {
      const known = typeof reference !== 'string' || this.options.registry.getCatalogSkills().some(skill => skill.name === reference);
      if (explicit && known) throw new Error('Selected skill is unavailable, excluded, or no longer authorized.');
      return false;
    }
    if (reason !== 'explicit' && entry.automatic === false) return false;
    const selected = typeof reference === 'string' ? entry.reference : reference;
    const key = selectionKey(selected);
    const previous = this.selections.get(key);
    if (previous && (!selected.revision || selected.revision === previous.reference.revision)) {
      if (allowArchived) {
        previous.allowArchived = true;
        if (previous.packet) previous.packet.allowArchived = true;
      }
      if (explicit) {
        const skill = this.currentSkill(previous.reference);
        if (activate && skill && this.options.registry.getActivationOrigin(skill) !== 'user') {
          this.options.registry.activateSkill(typeof reference === 'string' ? reference : formatSkillReference(selected), 'user');
        }
        if (previous.reason !== 'restored') previous.reason = 'explicit';
      }
      return true;
    }
    if (this.selections.size >= MAX_SELECTIONS && !previous) throw new Error('Active skills exceed the session selection budget.');
    if (activate && !this.options.registry.activateSkill(typeof reference === 'string' ? reference : formatSkillReference(selected), reason === 'explicit' ? 'user' : 'agent')) {
      if (explicit) throw new Error('Selected skill could not be activated.');
      return false;
    }
    this.selections.set(key, { reference: { ...selected }, reason, allowArchived,
      attested: false, pendingRestore: false });
    return true;
  }

  private synchronizeActive(initial = false): void {
    const registry = this.options.registry;
    for (const skill of registry.getCatalogSkills()) {
      if (!skill.isActive) { this.activations.delete(skill); continue; }
      const reference = registry.getActivationReference?.(skill) ?? registry.getSkillReference(skill);
      const serialized = formatSkillReference(reference);
      const previous = this.activations.get(skill);
      const changed = !previous || previous.reference !== serialized
        || (registry.getActivationReference !== undefined && previous.token !== reference);
      const origin = registry.getActivationOrigin(skill);
      const suppressed = initial && !this.automatic && origin === 'agent';
      if (suppressed || (previous?.suppressed && !changed)) {
        this.activations.set(skill, { reference: serialized, token: reference, suppressed: true });
        continue;
      }
      this.activations.set(skill, { reference: serialized, token: reference, suppressed: false });
      const entry = registry.getSkillRuntime().resolve(reference);
      if (!entry) continue;
      if (origin === 'agent' && entry.automatic === false) {
        for (const [key, selected] of this.selections) {
          if (identity(selected.reference) === identity(reference)) this.selections.delete(key);
        }
        continue;
      }
      if (previous && previous.reference !== serialized) {
        for (const [key, selected] of this.selections) {
          if (identity(selected.reference) === identity(reference) && key !== selectionKey(reference)) this.selections.delete(key);
        }
      }
      const existing = this.selections.get(selectionKey(reference));
      if (!changed && existing) continue;
      const explicitArchive = origin === 'user' && reference.revision !== undefined
        && registry.getActivationReference !== undefined && reference !== registry.getSkillReference(skill);
      this.select(reference, origin === 'agent' ? 'agent' : 'explicit', origin !== 'agent', false, explicitArchive);
    }
  }

  private reconcile(): void {
    for (const [key, selection] of this.selections) {
      const current = this.currentSkill(selection.reference);
      if (!current && (selection.pendingRestore || selection.reason === 'explicit' || selection.reason === 'restored')) {
        throw new Error('Required selected skill is unavailable or no longer authorized.');
      }
      if (!current || (!current.isActive && !selection.pendingRestore)) this.selections.delete(key);
    }
  }

  private suppressUnrelatedActivations(instruction: string, explicit: readonly (SkillReference | string)[], planModeActive: boolean): void {
    const registry = this.options.registry;
    const runtime = registry.getSkillRuntime();
    const relevant = new Set(explicit.flatMap(reference => {
      const entry = runtime.resolve(reference);
      return entry ? [identity(entry.reference)] : [];
    }));
    const brainstorm = resolveBrainstormAutoInjection({ instruction, planModeActive, alreadyInjected: false });
    const intentNames = [
      ...(brainstorm ? ['brainstorm'] : []),
      ...(resolveComputerControlAutoInjection({ instruction, alreadyInjected: false }) ? ['computer-control'] : []),
      ...(resolveDebugAutoInjection({ instruction, alreadyInjected: false, brainstormInjected: brainstorm }) ? ['systematic-debugging'] : []),
    ];
    for (const name of intentNames) {
      const entry = runtime.resolve(name);
      if (entry && entry.automatic !== false) relevant.add(identity(entry.reference));
    }
    const implicit = registry.getCatalogSkills().filter(skill => skill.isActive && registry.getActivationOrigin(skill) === 'agent');
    if (!explicit.length && this.automatic && implicit.length) {
      for (const { entry } of runtime.search(instruction, MAX_SHORTLIST)) if (entry.automatic !== false) relevant.add(identity(entry.reference));
    }
    for (const skill of implicit) {
      const reference = registry.getActivationReference?.(skill) ?? registry.getSkillReference(skill);
      if ([...this.selections.values()].some(selected => identity(selected.reference) === identity(reference) && selected.reason === 'restored')) continue;
      if (relevant.has(identity(reference))) continue;
      for (const [key, selected] of this.selections) if (identity(selected.reference) === identity(reference)) this.selections.delete(key);
      this.activations.set(skill, { reference: formatSkillReference(reference), token: reference, suppressed: true });
    }
  }

  async beginTask(instruction: string, options: AdaptiveSkillTaskOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const generation = ++this.generation;
    await this.options.registry.ensureAdaptiveWorkspace();
    options.signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error('Skill selection belongs to a stale task.');
    const nextTaskId = options.taskId ?? randomUUID();
    const newTask = nextTaskId !== this.taskId;
    if (nextTaskId !== this.taskId) this.emitted.clear();
    this.taskId = nextTaskId;
    this.automatic = options.automatic !== false;
    this.reconcile();
    const explicit = explicitReferences(instruction);
    if (newTask) this.suppressUnrelatedActivations(instruction, explicit, options.planModeActive ?? false);
    if (options.automatic === false) {
      for (const [key, selection] of this.selections) {
        const skill = this.currentSkill(selection.reference);
        if (skill && this.options.registry.getActivationOrigin(skill) === 'agent' && selection.reason !== 'restored') {
          this.selections.delete(key);
        }
      }
    }
    for (const selection of this.selections.values()) {
      if (selection.pendingRestore) {
        const skill = this.currentSkill(selection.reference);
        const origin = skill && this.options.registry.getActivationOrigin(skill) === 'user' ? 'user' : 'agent';
        if (!this.options.registry.activateSkill(formatSkillReference(selection.reference), origin)) throw new Error('Pinned skill is unavailable.');
        selection.pendingRestore = false;
      }
    }
    this.synchronizeActive(true);
    const explicitNames = new Set<string>();
    for (const reference of explicit) {
      if (this.select(reference, 'explicit', true)) explicitNames.add(this.options.registry.getSkillRuntime().resolve(reference)!.name);
    }
    if (options.automatic === false) return;
    let brainstorm = explicitNames.has('brainstorm');
    if (resolveBrainstormAutoInjection({ instruction, planModeActive: options.planModeActive ?? false, alreadyInjected: brainstorm })) {
      brainstorm = this.select('brainstorm', 'local');
    }
    const computer = resolveComputerControlAutoInjection({ instruction, alreadyInjected: explicitNames.has('computer-control') })
      && this.select('computer-control', 'local');
    const debug = resolveDebugAutoInjection({ instruction, alreadyInjected: explicitNames.has('systematic-debugging'), brainstormInjected: brainstorm })
      && this.select('systematic-debugging', 'local');
    if (explicit.length || brainstorm || computer || debug) return;
    await this.selectLocal(instruction, options.signal, generation);
  }

  private async selectLocal(instruction: string, signal: AbortSignal | undefined, generation: number): Promise<void> {
    const matches = this.options.registry.getSkillRuntime().search(instruction, MAX_SHORTLIST).filter(match => match.entry.automatic !== false);
    const first = matches[0];
    if (!first) return;
    if (first.score >= MIN_CONFIDENT_SCORE && first.score - (matches[1]?.score ?? 0) >= MIN_CONFIDENT_MARGIN) {
      this.select(first.entry.reference, 'local');
      return;
    }
    const candidates = matches.filter(match => match.score >= MIN_RERANK_SCORE).map(({ entry, score }) => ({
      reference: { ...entry.reference }, name: entry.name, description: entry.description, scope: entry.scope, score,
    }));
    if (candidates.length < 2 || !this.options.rerank) return;
    const allowed = new Map(candidates.map(candidate => [formatSkillReference(candidate.reference), candidate]));
    let selected: SkillReference | null;
    try { selected = await this.options.rerank({ instruction: instruction.slice(0, 8_000),
      candidates: candidates.map(candidate => ({ ...candidate, reference: { ...candidate.reference } })), signal }); }
    catch { signal?.throwIfAborted(); return; }
    signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error('Skill reranking belongs to a stale task.');
    const candidate = selected && allowed.get(formatSkillReference(selected));
    if (candidate) this.select(candidate.reference, 'local');
  }

  async prepareRequest(options: AdaptiveSkillRequestOptions): Promise<PreparedSkillPacket[]> {
    options.signal?.throwIfAborted();
    if (!this.taskId) return [];
    if (!Number.isFinite(options.maxTokens) || options.maxTokens < 0) throw new Error('Invalid skill instruction token budget.');
    const taskId = this.taskId;
    const generation = this.generation;
    this.synchronizeActive();
    this.reconcile();
    const packets: PreparedSkillPacket[] = [];
    for (const selection of this.selections.values()) {
      options.signal?.throwIfAborted();
      if (selection.packet && !selection.attested && !selection.allowArchived) {
        const checked = await this.options.registry.getSkillRuntime().prepare(selection.packet.reference, {
          taskId, reason: selection.reason, maxTokens: options.maxTokens, signal: options.signal, allowArchived: false,
        });
        if (checked.contentDigest !== selection.packet.contentDigest) throw new Error('Skill packet changed before its first accepted request.');
        if (generation !== this.generation) throw new Error('Prepared skills belong to a stale task.');
      } else if (selection.packet) {
        await this.options.registry.getSkillRuntime().validatePreparedResources(selection.packet);
        if (generation !== this.generation) throw new Error('Prepared skills belong to a stale task.');
      } else if (!selection.packet) {
        const packet = await this.options.registry.getSkillRuntime().prepare(selection.reference, {
          taskId, reason: selection.reason, maxTokens: options.maxTokens, signal: options.signal,
          allowArchived: selection.allowArchived || selection.attested,
        });
        if (generation !== this.generation) throw new Error('Prepared skills belong to a stale task.');
        selection.packet = packet;
        selection.reference = { ...packet.reference };
      }
      const reason = selection.attested && selection.packet.taskId !== taskId ? 'restored' : selection.reason;
      const packet = clonePacket(selection.packet, taskId, reason);
      if (!this.currentSkill(selection.reference)?.isActive) {
        this.reconcile();
        this.selections.delete(selectionKey(selection.reference));
        continue;
      }
      for (const dependency of flattenPackets([packet])) {
        if (!this.options.registry.getSkillRuntime().resolve(dependency.reference)) throw new Error('Required skill dependency is no longer authorized.');
      }
      packets.push(packet);
    }
    const embedded = new Set(packets.flatMap(packet => flattenPackets(packet.dependencies).map(packetKey)));
    const unique = [...new Map(packets.filter(packet => !embedded.has(packetKey(packet))).map(packet => [packetKey(packet), packet])).values()];
    const total = unique.reduce((sum, packet) => sum + packet.estimatedTokens, 0);
    if (total > options.maxTokens) throw new Error(`Required skill instructions need ${total} tokens; available budget is ${options.maxTokens}. No instructions were truncated.`);
    options.signal?.throwIfAborted();
    return unique;
  }

  async acknowledgeRequest(packets: readonly PreparedSkillPacket[], observation: AdaptiveSkillAcknowledgement): Promise<SkillAttachmentReceipt[]> {
    observation.signal?.throwIfAborted();
    if (!packets.length) return [];
    const taskId = this.taskId;
    const generation = this.generation;
    for (const packet of packets) {
      const selection = this.selections.get(selectionKey(packet.reference));
      if (!taskId || packet.taskId !== taskId || !selection?.packet || selection.packet.contentDigest !== packet.contentDigest) {
        throw new Error('Skill request belongs to a stale or unprepared task.');
      }
      if (!this.currentSkill(packet.reference)?.isActive) throw new Error('Skill is no longer active or authorized.');
    }
    const receipts = await this.options.registry.getSkillRuntime().acknowledgeDispatch(flattenPackets(packets), {
      taskId: taskId!, requestId: observation.requestId, sessionId: observation.sessionId, adapter: this.options.adapter ?? 'autohand',
      content: observation.content, policyEpoch: observation.policyEpoch,
    });
    observation.signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error('Skill acknowledgement belongs to a stale task.');
    const emitted: SkillAttachmentReceipt[] = [];
    for (const receipt of receipts) {
      const selection = this.selections.get(selectionKey(receipt.reference));
      if (selection) selection.attested = true;
      const key = `${receipt.taskId}\n${formatSkillReference(receipt.reference)}\n${receipt.contentDigest}`;
      if (this.emitted.has(key)) continue;
      if (this.emitted.size >= MAX_SELECTIONS * 4) throw new Error('Skill receipt rows exceed the active task budget.');
      this.emitted.add(key);
      emitted.push(receipt);
    }
    return emitted;
  }

  getPinnedReferences(): ExactSkillReference[] {
    const references = new Map<string, ExactSkillReference>();
    for (const selection of this.selections.values()) {
      if (!this.currentSkill(selection.reference) || (!selection.pendingRestore && !this.currentSkill(selection.reference)?.isActive)) continue;
      const pinned = selection.packet ? flattenPackets([selection.packet]).map(packet => packet.reference)
        : selection.reference.revision ? [{ ...selection.reference, revision: selection.reference.revision }] : [];
      for (const reference of pinned) references.set(formatSkillReference(reference), { ...reference });
    }
    return [...references.values()];
  }

  getTaskId(): string | undefined {
    return this.taskId ?? undefined;
  }

  restorePins(references: readonly ExactSkillReference[]): void {
    if (references.length > MAX_SELECTIONS) throw new Error('Restored skill pins exceed the selection budget.');
    const revisions = new Map<string, string>();
    const restored = references.map(reference => {
      if (!reference.authority || !reference.packageId || !/^sha256:[a-f0-9]{64}$/u.test(reference.revision)) {
        throw new Error('Restoring a skill requires an exact valid revision.');
      }
      const previous = revisions.get(selectionKey(reference));
      if (previous && previous !== reference.revision) throw new Error('Restored skill pins contain conflicting revisions.');
      revisions.set(selectionKey(reference), reference.revision);
      return { ...reference };
    });
    this.reset();
    for (const reference of restored) this.selections.set(selectionKey(reference), {
      reference, reason: 'restored', attested: false, pendingRestore: true, allowArchived: true,
    });
  }

  reset(): void {
    this.generation++;
    this.taskId = null;
    this.selections.clear();
    this.emitted.clear();
  }
}
