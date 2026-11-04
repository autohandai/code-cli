import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { estimateTokens } from '../core/context/tokenizer.js';
import { pushBounded } from '../utils/bounded.js';
import { createSkillRevisionManifest, computeSkillRevision, type SkillRevisionStore } from './SkillRevisionStore.js';
import type { SkillResourceMaterializer } from './SkillResourceMaterializer.js';

export interface SkillReference {
  authority: string;
  packageId: string;
  revision?: string;
  resource?: string;
}

export interface SkillCatalogEntry {
  reference: SkillReference;
  name: string;
  description: string;
  source: string;
  scope: string;
  root: string;
  enabled: boolean;
  compatible?: boolean;
  requiredResources?: string[];
  dependencies?: SkillReference[];
  automatic?: boolean;
  quality?: 'draft' | 'verified' | 'preferred';
  preference?: number;
}

export interface SkillResourceDigest { path: string; sha256: string; bytes: number }
export type SkillSelectionReason = 'explicit' | 'local' | 'agent' | 'restored';

export interface PreparedSkillPacket {
  version: 1;
  reference: SkillReference & { revision: string };
  name: string;
  scope: string;
  taskId: string;
  reason: SkillSelectionReason;
  content: string;
  contentDigest: string;
  manifest: SkillResourceDigest[];
  estimatedTokens: number;
  dependencies: PreparedSkillPacket[];
  resourcePaths: string[];
  resourceRoot?: string;
  /** Host preparation choice; a revision in catalog metadata does not authorize archive fallback. */
  allowArchived?: boolean;
}

export interface SkillAttachmentReceipt {
  version: 1;
  taskId: string;
  sessionId: string;
  requestId: string;
  reference: SkillReference;
  contentDigest: string;
  reason: SkillSelectionReason;
  state: 'submitted' | 'supplied';
  capability: 'provider-request' | 'external-handoff';
  policyEpoch: number;
  recordedAt: number;
  scope: string;
  resources: SkillResourceDigest[];
}

export interface SkillRuntimeOptions {
  catalog(): readonly SkillCatalogEntry[];
  authorizedScopes(): ReadonlySet<string>;
  countTokens?(text: string): number;
  maxFiles?: number;
  maxPackageBytes?: number;
  revisionStore?: SkillRevisionStore;
  resourceMaterializer?: SkillResourceMaterializer;
}

export interface SkillSearchMatch { entry: SkillCatalogEntry; score: number }

export interface SkillPreparationOptions {
  taskId: string;
  reason: SkillSelectionReason;
  maxTokens: number;
  signal?: AbortSignal;
  allowArchived?: boolean;
}

export interface SkillDispatchObservation {
  taskId: string;
  sessionId: string;
  requestId: string;
  adapter: 'autohand' | 'external';
  content: readonly string[];
  policyEpoch: number;
}

const STOP_WORDS = new Set('a an the this that these those i we you my our your is are was be to of for in on at it and or with please help me can could would should skill skills use using task'.split(' '));
const SYNONYMS: Readonly<Record<string, string>> = {
  bugs: 'debug', bug: 'debug', debugging: 'debug', diagnose: 'debug', diagnosis: 'debug',
  errors: 'error', failures: 'error', failure: 'error', failing: 'error', broken: 'error',
  researching: 'research', investigate: 'research', investigation: 'research',
  performance: 'performance', slow: 'performance', latency: 'performance',
  tests: 'test', testing: 'test', reviewed: 'review', reviewing: 'review',
};

function tokens(text: string): Set<string> {
  return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [])
    .filter(token => !STOP_WORDS.has(token)).map(token => SYNONYMS[token] ?? token));
}

function digest(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function formatSkillReference(reference: SkillReference): string {
  const suffix = new URLSearchParams();
  if (reference.revision) suffix.set('revision', reference.revision);
  if (reference.resource) suffix.set('resource', reference.resource);
  return `skill://${encodeURIComponent(reference.authority)}/${encodeURIComponent(reference.packageId)}${suffix.size ? `?${suffix}` : ''}`;
}

export function parseSkillReference(value: string): SkillReference | null {
  if (!value.startsWith('skill://')) return null;
  const match = /^skill:\/\/([^/]+)\/([^?]+)(?:\?(.*))?$/.exec(value);
  if (!match) return null;
  try {
    const query = new URLSearchParams(match[3]);
    const reference: SkillReference = { authority: decodeURIComponent(match[1]), packageId: decodeURIComponent(match[2]) };
    if (!reference.authority || !reference.packageId) return null;
    if (query.has('revision')) reference.revision = query.get('revision')!;
    if (query.has('resource')) reference.resource = query.get('resource')!;
    return reference;
  } catch { return null; }
}

function identity(reference: SkillReference): string {
  return formatSkillReference({ authority: reference.authority, packageId: reference.packageId });
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

const resourcePath = z.string().min(1).max(512).refine(value => !value.includes('\\') && !value.startsWith('/')
  && !/[\u0000-\u001f\u007f]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'));
const declaration = z.object({ version: z.literal(1), requiredResources: z.array(resourcePath).max(32).optional(),
  dependencies: z.array(z.object({ authority: z.string().min(1).max(512), packageId: z.string().min(1).max(512),
    revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u), resource: resourcePath.optional() }).strict()).max(16).optional(),
}).strict();

function readDeclaration(files: ReadonlyMap<string, Uint8Array>): z.infer<typeof declaration> {
  const bytes = files.get('skill.runtime.json');
  if (!bytes) return { version: 1 };
  try {
    if (bytes.byteLength > 64_000) throw new Error('Declaration exceeds its budget');
    return declaration.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch { throw new Error('Invalid skill runtime declaration. Required resources and dependencies were not omitted.'); }
}

export async function readSkillPackage(root: string, options: Pick<SkillRuntimeOptions, 'maxFiles' | 'maxPackageBytes'> = {}, signal?: AbortSignal): Promise<Map<string, Buffer>> {
  const canonicalRoot = await realpath(root);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const walk = async (directory: string, prefix: string, ancestors: ReadonlySet<string>): Promise<void> => {
    signal?.throwIfAborted();
    const canonical = await realpath(directory);
    if (!contained(canonicalRoot, canonical)) throw new Error('Skill resource escapes its authorized package root.');
    if (ancestors.has(canonical)) throw new Error('Skill resource directory cycle.');
    const next = new Set([...ancestors, canonical]);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      signal?.throwIfAborted();
      if (['.git', '.hg'].includes(entry.name)) throw new Error('Version-control metadata is not a skill resource. Remove it from the package before activation.');
      const filename = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const actual = await realpath(filename);
      if (!contained(canonicalRoot, actual)) throw new Error(`Skill resource escapes its authorized package root: ${relative}`);
      const info = await lstat(actual);
      if (info.isDirectory()) { await walk(filename, relative, next); continue; }
      if (!info.isFile()) throw new Error(`Unsupported skill resource: ${relative}`);
      if (files.size >= (options.maxFiles ?? 2_048) || bytes + info.size > (options.maxPackageBytes ?? 16_000_000)) {
        throw new Error('Skill package exceeds the resource budget; no files were silently omitted.');
      }
      const content = await readFile(actual);
      bytes += content.byteLength;
      if (bytes > (options.maxPackageBytes ?? 16_000_000)) throw new Error('Skill package exceeds the resource budget.');
      files.set(relative, content);
    }
  };
  await walk(canonicalRoot, '', new Set());
  if (!files.has('SKILL.md')) throw new Error('Skill package has no SKILL.md.');
  return files;
}

export class SkillRuntime {
  private readonly history: SkillAttachmentReceipt[] = [];
  private readonly searchTokens = new WeakMap<SkillCatalogEntry, { signature: string; name: Set<string>; description: Set<string> }>();

  constructor(private readonly options: SkillRuntimeOptions) {}

  private catalog(): readonly SkillCatalogEntry[] {
    const scopes = this.options.authorizedScopes();
    return this.options.catalog().filter(entry => entry.enabled && entry.compatible !== false && scopes.has(entry.scope));
  }

  list(): readonly SkillCatalogEntry[] { return this.catalog(); }

  resolve(reference: SkillReference | string): SkillCatalogEntry | null {
    const entries = this.catalog();
    const parsed = typeof reference === 'string' ? parseSkillReference(reference) : reference;
    if (parsed) {
      const matching = entries.filter(entry => identity(entry.reference) === identity(parsed));
      if (parsed.revision) return matching.find(entry => entry.reference.revision === parsed.revision)
        ?? matching.find(entry => !entry.reference.revision) ?? null;
      return matching[0] ?? null;
    }
    return entries.find(entry => entry.name === reference) ?? null;
  }

  search(query: string, limit = 8): SkillSearchMatch[] {
    if (/^\s*(?:hi|hello|hey|thanks|thank you|good morning|good evening)[!.,\s]*$/i.test(query)) return [];
    const wanted = tokens(query.slice(0, 8_000));
    if (!wanted.size) return [];
    const matches: Array<{ entry: SkillCatalogEntry; score: number }> = [];
    for (const entry of this.catalog()) {
      const signature = `${entry.name}\n${entry.description}`;
      let indexed = this.searchTokens.get(entry);
      if (!indexed || indexed.signature !== signature) {
        indexed = { signature, name: tokens(entry.name), description: tokens(entry.description) };
        this.searchTokens.set(entry, indexed);
      }
      let matched = 0;
      for (const token of wanted) matched += indexed.name.has(token) ? 2 : indexed.description.has(token) ? 1 : 0;
      const score = matched / (2 * wanted.size);
      if (score >= 0.2) matches.push({ entry, score: Math.min(1, score + Math.min(0.05, Math.max(0, entry.preference ?? 0))) });
    }
    return matches.sort((a, b) => b.score - a.score || compare(identity(a.entry.reference), identity(b.entry.reference)))
      .slice(0, Math.max(1, Math.min(32, Number.isFinite(limit) ? Math.floor(limit) : 8)));
  }

  async prepare(reference: SkillReference | string, options: SkillPreparationOptions, ancestors = new Set<string>(), budget = { remaining: 128 }): Promise<PreparedSkillPacket> {
    options.signal?.throwIfAborted();
    if (--budget.remaining < 0 || ancestors.size >= 32) throw new Error('Skill dependency graph exceeds the preparation budget.');
    const entry = this.resolve(reference);
    if (!entry) throw new Error('Skill is unavailable or no longer authorized.');
    const selected = typeof reference === 'string' ? parseSkillReference(reference) ?? entry.reference : reference;
    const key = identity(entry.reference);
    if (ancestors.has(key)) throw new Error(`Skill dependency cycle: ${key}`);
    let files: ReadonlyMap<string, Uint8Array>;
    try { files = await readSkillPackage(entry.root, this.options, options.signal); }
    catch (error) {
      const archived = selected.revision && options.allowArchived ? await this.options.revisionStore?.read({ ...selected, revision: selected.revision }) : null;
      if (!archived) throw error;
      files = archived.files;
    }
    let manifest = createSkillRevisionManifest(files);
    let revision = computeSkillRevision(manifest);
    if (selected.revision && selected.revision !== revision && options.allowArchived) {
      const archived = await this.options.revisionStore?.read({ ...selected, revision: selected.revision });
      if (archived) { files = archived.files; manifest = [...archived.manifest]; revision = selected.revision; }
    }
    if (selected.revision && selected.revision !== revision) throw new Error(`Pinned skill revision is unavailable: ${selected.revision}; current revision is ${revision}.`);
    const pinned = { ...entry.reference, ...(selected.resource ? { resource: selected.resource } : {}), revision };
    const declared = readDeclaration(files);
    if (this.options.revisionStore) await this.options.revisionStore.publish({ reference: pinned, manifest, files });
    const resourceRoot = await this.options.resourceMaterializer?.materialize({ reference: pinned, manifest, files });
    const parts = [`[Skill packet ${formatSkillReference(pinned)}]`];
    const resourcePaths = [...new Set(['SKILL.md', ...(entry.requiredResources ?? []), ...(declared.requiredResources ?? []), ...(selected.resource ? [selected.resource] : [])])];
    for (const resource of resourcePaths) {
      const content = files.get(resource);
      if (!content) throw new Error(`Required skill resource is unavailable: ${resource}`);
      parts.push(`Resource: ${resource}\n${new TextDecoder('utf-8', { fatal: true }).decode(content)}`);
    }
    const dependencies: PreparedSkillPacket[] = [];
    const next = new Set([...ancestors, key]);
    const dependencyRefs = new Map([...(entry.dependencies ?? []), ...(declared.dependencies ?? [])].map(ref => [formatSkillReference(ref), ref]));
    for (const dependency of dependencyRefs.values()) dependencies.push(await this.prepare(dependency, options, next, budget));
    parts.push(...dependencies.map(dependency => dependency.content));
    const content = parts.join('\n\n');
    const estimatedTokens = (this.options.countTokens ?? estimateTokens)(content);
    if (!Number.isFinite(options.maxTokens) || estimatedTokens > options.maxTokens) {
      throw new Error(`Required skill instructions need ${estimatedTokens} tokens; available budget is ${options.maxTokens}. No instructions were truncated.`);
    }
    return { version: 1, reference: pinned, name: entry.name, scope: entry.scope, taskId: options.taskId, reason: options.reason,
      content, contentDigest: digest(content), manifest, estimatedTokens, dependencies, resourcePaths,
      ...(options.allowArchived ? { allowArchived: true } : {}), ...(resourceRoot ? { resourceRoot } : {}) };
  }

  async validatePreparedResources(packet: PreparedSkillPacket): Promise<void> {
    const visited = new Set<string>();
    const validate = async (current: PreparedSkillPacket): Promise<void> => {
      const key = `${formatSkillReference(current.reference)}\n${current.contentDigest}`;
      if (visited.has(key)) return;
      if (visited.size >= 128) throw new Error('Prepared skill resource graph exceeds its validation budget.');
      visited.add(key);
      if (!this.resolve(current.reference)) throw new Error('Pinned skill resource is no longer authorized.');
      if (this.options.resourceMaterializer) {
        if (!current.resourceRoot) throw new Error('Pinned skill resource root is unavailable.');
        const archived = await this.options.revisionStore?.read(current.reference);
        if (!archived) throw new Error('Pinned skill resource archive is unavailable.');
        await this.options.resourceMaterializer.verify(archived, current.resourceRoot);
      } else if (current.resourceRoot) {
        throw new Error('Pinned skill resource root is unavailable under the current runtime policy.');
      }
      for (const dependency of current.dependencies) await validate(dependency);
    };
    await validate(packet);
  }

  async acknowledgeDispatch(packets: readonly PreparedSkillPacket[], observation: SkillDispatchObservation): Promise<SkillAttachmentReceipt[]> {
    const pending: SkillAttachmentReceipt[] = [];
    for (const packet of packets) {
      if (digest(packet.content) !== packet.contentDigest) throw new Error('Prepared skill packet integrity check failed: content digest was modified.');
      if (packet.taskId !== observation.taskId || !observation.content.some(content => content.includes(packet.content))) {
        throw new Error('Observed request content does not contain the prepared skill packet for this task.');
      }
      const allowArchived = packet.reason === 'restored' || (packet.reason === 'explicit' && packet.allowArchived === true)
        || this.history.some(receipt => receipt.taskId === packet.taskId && receipt.contentDigest === packet.contentDigest);
      const current = await this.prepare(packet.reference, { taskId: packet.taskId, reason: packet.reason, maxTokens: Number.MAX_SAFE_INTEGER, allowArchived });
      if (current.contentDigest !== packet.contentDigest) throw new Error('Skill packet changed after preparation.');
      pending.push({ version: 1, taskId: observation.taskId, sessionId: observation.sessionId, requestId: observation.requestId,
        reference: packet.reference, contentDigest: packet.contentDigest, reason: packet.reason,
        state: observation.adapter === 'autohand' ? 'submitted' : 'supplied',
        capability: observation.adapter === 'autohand' ? 'provider-request' : 'external-handoff',
        policyEpoch: observation.policyEpoch, recordedAt: Date.now(), scope: current.scope,
        resources: current.manifest.filter(resource => current.resourcePaths.includes(resource.path)) });
    }
    for (const receipt of pending) {
      if (!this.history.some(existing => existing.taskId === receipt.taskId && existing.requestId === receipt.requestId
        && existing.contentDigest === receipt.contentDigest && identity(existing.reference) === identity(receipt.reference))) {
        pushBounded(this.history, receipt, 512);
      }
    }
    return pending;
  }

  receipts(): readonly SkillAttachmentReceipt[] { return this.history.map(receipt => ({ ...receipt, reference: { ...receipt.reference } })); }
}
