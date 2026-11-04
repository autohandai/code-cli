/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillsRegistry - Manages skill discovery, loading, and activation
 */
import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { SkillParser } from './SkillParser.js';
import { estimateTokens } from '../core/context/tokenizer.js';
import { resolveEmbeddedBuiltinAssetDirectory } from './embeddedBuiltinAssets.js';
import { readAccountSkills } from '../sync/AccountSkills.js';
import type {
  SkillDefinition,
  SkillSource,
  SkillSimilarityMatch,
  SkillCopyResult,
  AdaptiveSkillSettings,
} from './types.js';
import { SkillRuntime, formatSkillReference, parseSkillReference, type SkillCatalogEntry, type SkillReference } from './SkillRuntime.js';
import { SkillRevisionStore } from './SkillRevisionStore.js';
import { SkillResourceMaterializer } from './SkillResourceMaterializer.js';
import { SkillSnapshotCatalog } from './SkillSnapshotCatalog.js';
import { ensureSkillWorkspaceIdentity, readSkillWorkspaceIdentity } from './workspaceIdentity.js';
import { AdaptiveSkillSession, type AdaptiveSkillSessionOptions } from './AdaptiveSkillSession.js';
import type { LearnedSkillCandidate } from './SkillLearningStore.js';
import type { ExtensionSkillContribution } from '../extensions/types.js';
import {
  AUTOHAND_PATHS,
  PROJECT_DIR_NAME,
  getProjectSkillLocations,
  getUserSkillLocations,
} from '../constants.js';
import type { TelemetryManager } from '../telemetry/TelemetryManager.js';
import type { SkillUseData } from '../telemetry/types.js';
import type {
  CapabilityUsageInput,
  CapabilityUsageOrigin,
} from '../memory/types.js';
import type { CommunitySkillsClient, CommunitySkillPackage, BackupPayload } from './CommunitySkillsClient.js';
import {
  assertCommunityPathSymlinkSafe,
  resolveContainedCommunityPath,
  validateCommunitySkillFileMap,
  validateCommunitySkillIdentifier,
} from './communitySkillPaths.js';

const SIMILARITY_THRESHOLD = 0.3;
const BUILTIN_SKILLS_DIR = 'builtin';

export interface SkillSearchLocation {
  /** Stable host-assigned authority for a custom library; independent of its current path. */
  authority?: string;
  basePath: string;
  source: SkillSource;
  recursive: boolean;
}

export interface SkillsRegistryOptions {
  adaptiveEnabled?: () => boolean;
  getAdaptiveSettings?: () => AdaptiveSkillSettings | undefined;
  /** Bind account skills to this CLI profile; another process cannot select its account. */
  accountConfigPath?: string;
  /**
   * Overrides the user-level discovery locations. Tests and embedded callers can
   * use this to keep discovery scoped to temporary directories.
   */
  userSkillLocations?: SkillSearchLocation[];
  /**
   * Production registries discover Codex/Claude/Autohand user skills together.
   * Custom registries default to their explicit directory only.
   */
  includeDefaultUserSkillLocations?: boolean;
  /** Override the home directory used to resolve default user skill locations. */
  homeDir?: string;
  /** Override where packaged built-in skills are looked up; tests use this to simulate a compiled binary. */
  builtinSkillDirectories?: string[];
  /** Override where embedded built-in assets are materialized when no packaged directory exists. */
  embeddedBuiltinAssetsRoot?: string;
}

function sameResolvedPath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function createDefaultUserSkillLocations(
  userSkillsDir: string,
  defaultSource: SkillSource,
  homeDir?: string
): SkillSearchLocation[] {
  return getUserSkillLocations(homeDir, userSkillsDir).map((location) =>
    sameResolvedPath(location.basePath, userSkillsDir)
      ? { ...location, source: defaultSource }
      : location
  );
}

/**
 * Registry for managing Agent Skills
 */
/** Vendor skill sources that indicate externally managed skills. */
const VENDOR_SOURCES: SkillSource[] = [
  'codex-user',
  'claude-user',
  'codex-project',
  'claude-project',
  'agent-user',
  'agent-project',
];

/**
 * Result of importing a community skill
 */
export interface SkillImportResult {
  success: boolean;
  path?: string;
  error?: string;
  skipped?: boolean;
}

export class SkillsRegistry {
  private skills = new Map<string, SkillDefinition>();
  private readonly catalogDefinitions = new Map<string, { skill: SkillDefinition; root: string }>();
  private readonly catalogEntries = new WeakMap<SkillDefinition, SkillCatalogEntry>();
  private readonly activationOrigins = new WeakMap<SkillDefinition, CapabilityUsageOrigin>();
  private readonly activationReferences = new WeakMap<SkillDefinition, SkillReference>();
  private workspaceIdentity: string | null = null;
  private canonicalRuntime?: SkillRuntime;
  private adaptiveSession?: AdaptiveSkillSession;
  private adaptiveRerank?: AdaptiveSkillSessionOptions['rerank'];
  private readonly snapshotCatalog: SkillSnapshotCatalog;
  private learnedSkills = new Map<string, { skill: SkillDefinition; candidate: LearnedSkillCandidate }>();
  private learnedMetadata = new WeakMap<SkillDefinition, LearnedSkillCandidate>();
  /**
   * Open span per active skill, keyed by name. An activated skill is added to
   * the session prompt and stays there, so its body is re-sent on every later
   * request until something closes the span — the cost that was previously
   * invisible because only the activation was ever reported.
   */
  private readonly activeSpans = new Map<string, string>();
  private parser = new SkillParser();
  private workspaceRoot: string | null = null;
  private readonly defaultSource: SkillSource;
  private telemetryManager: TelemetryManager | null = null;
  private capabilityUsageRecorder:
    | ((usage: CapabilityUsageInput) => void | Promise<void>)
    | null = null;
  private readonly capabilityUsageWrites = new Set<Promise<void>>();
  private communityClient: CommunitySkillsClient | null = null;
  private readonly extensionSkillNames = new Set<string>();

  constructor(
    private readonly userSkillsDir: string,
    defaultSource: SkillSource = 'autohand-user',
    private readonly options: SkillsRegistryOptions = {}
  ) {
    this.defaultSource = defaultSource;
    this.snapshotCatalog = new SkillSnapshotCatalog(userSkillsDir, { managed: process.env.AUTOHAND_SKILL_SNAPSHOT_MANAGED === '1' });
  }

  /**
   * Set the telemetry manager for tracking skill events
   */
  setTelemetryManager(telemetryManager: TelemetryManager): void {
    this.telemetryManager = telemetryManager;
  }

  setCapabilityUsageRecorder(
    recorder: (usage: CapabilityUsageInput) => void | Promise<void>,
  ): void {
    this.capabilityUsageRecorder = recorder;
  }

  async flushCapabilityUsage(): Promise<void> {
    while (this.capabilityUsageWrites.size > 0) {
      await Promise.allSettled([...this.capabilityUsageWrites]);
    }
  }

  /**
   * Set the community skills client for backup/sync operations
   */
  setCommunityClient(client: CommunitySkillsClient | null): void {
    this.communityClient = client;
  }

  /**
   * Get the community skills client
   */
  getCommunityClient(): CommunitySkillsClient | null {
    return this.communityClient;
  }

  /**
   * Check if any vendor skills (codex/claude) are loaded
   */
  hasVendorSkills(): boolean {
    for (const skill of this.skills.values()) {
      if (VENDOR_SOURCES.includes(skill.source)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all vendor skills (from codex/claude sources)
   */
  getVendorSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(
      skill => VENDOR_SOURCES.includes(skill.source)
    );
  }

  /**
   * Import a community skill package and save to disk
   */
  async importCommunitySkill(
    pkg: CommunitySkillPackage,
    targetDir: string
  ): Promise<SkillImportResult> {
    if (!pkg.body || typeof pkg.body !== 'string') {
      return { success: false, error: 'Invalid skill package: missing name or body' };
    }

    try {
      const skillName = validateCommunitySkillIdentifier(pkg.name, 'community skill name');
      const skillDir = resolveContainedCommunityPath(
        targetDir,
        skillName,
        'community skill install directory'
      );
      const skillPath = resolveContainedCommunityPath(
        skillDir,
        'SKILL.md',
        'community skill file'
      );
      await assertCommunityPathSymlinkSafe(
        targetDir,
        skillDir,
        'community skill install directory'
      );
      await assertCommunityPathSymlinkSafe(skillDir, skillPath, 'community skill file');

      // Check if already exists only after the complete destination is validated.
      if (await fs.pathExists(skillPath)) {
        return { success: false, skipped: true, error: 'Skill already exists' };
      }

      await fs.ensureDir(skillDir);
      await fs.writeFile(skillPath, pkg.body, 'utf-8');

      // Parse and register the skill
      const result = await this.parser.parseFile(skillPath, 'community');
      if (result.success && result.skill) {
        this.registerSkill(result.skill);
        return { success: true, path: skillPath };
      }

      return { success: false, error: 'Failed to parse imported skill' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error };
    }
  }

  /**
   * Import a community skill directory with multiple files
   * Used for skills from GitHub that include templates, examples, etc.
   *
   * @param skillName - Name of the skill (used as directory name)
   * @param files - Map of relative file paths to their contents
   * @param targetDir - Target directory (user or project skills dir)
   * @param force - Overwrite if skill already exists
   */
  async importCommunitySkillDirectory(
    skillName: string,
    files: Map<string, string>,
    targetDir: string,
    force = false
  ): Promise<SkillImportResult> {
    try {
      const validatedName = validateCommunitySkillIdentifier(skillName, 'community skill name');
      const validatedFiles = validateCommunitySkillFileMap(files);
      const skillDir = resolveContainedCommunityPath(
        targetDir,
        validatedName,
        'community skill install directory'
      );
      const destinations = [...validatedFiles.keys()].map((relativePath) => (
        resolveContainedCommunityPath(skillDir, relativePath, 'community skill file')
      ));
      const skillPath = resolveContainedCommunityPath(
        skillDir,
        'SKILL.md',
        'community skill file'
      );

      await assertCommunityPathSymlinkSafe(
        targetDir,
        skillDir,
        'community skill install directory'
      );
      await Promise.all(destinations.map((destination) => (
        assertCommunityPathSymlinkSafe(skillDir, destination, 'community skill file')
      )));

      // Check if already exists only after every destination is validated.
      if (!force && (await fs.pathExists(skillPath))) {
        return { success: false, skipped: true, error: 'Skill already exists' };
      }

      // Remove existing skill directory if force is true
      if (force && (await fs.pathExists(skillDir))) {
        await fs.remove(skillDir);
      }

      // Write all files from the Map
      for (const [relativePath, content] of validatedFiles) {
        const fullPath = resolveContainedCommunityPath(
          skillDir,
          relativePath,
          'community skill file'
        );
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf-8');
      }

      // Parse and register the skill from SKILL.md
      const result = await this.parser.parseFile(skillPath, 'community');
      if (result.success && result.skill) {
        this.registerSkill(result.skill);
        return { success: true, path: skillDir };
      }

      return { success: false, error: 'Failed to parse imported skill' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error };
    }
  }

  /**
   * Check if a skill is already installed
   */
  async isSkillInstalled(skillName: string, targetDir: string): Promise<boolean> {
    const validatedName = validateCommunitySkillIdentifier(skillName, 'community skill name');
    const skillDir = resolveContainedCommunityPath(
      targetDir,
      validatedName,
      'community skill install directory'
    );
    const skillPath = resolveContainedCommunityPath(skillDir, 'SKILL.md', 'community skill file');
    await assertCommunityPathSymlinkSafe(
      targetDir,
      skillDir,
      'community skill install directory'
    );
    await assertCommunityPathSymlinkSafe(skillDir, skillPath, 'community skill file');
    return fs.pathExists(skillPath);
  }

  /**
   * Get the user skills directory path
   */
  getUserSkillsDir(): string {
    return this.userSkillsDir;
  }

  private registerSkill(skill: SkillDefinition, root = path.dirname(path.dirname(skill.path))): void {
    this.skills.set(skill.name, skill);
    this.catalogDefinitions.set(skill.path, { skill, root });
  }

  async ensureAdaptiveWorkspace(): Promise<void> {
    if (!this.workspaceRoot || this.workspaceIdentity) return;
    const previous = new Map(this.getCatalogSkills().map(skill => [skill, formatSkillReference(this.getSkillReference(skill))]));
    this.workspaceIdentity = await ensureSkillWorkspaceIdentity(this.workspaceRoot);
    for (const [skill, oldKey] of previous) {
      const span = this.activeSpans.get(oldKey);
      if (span) { this.activeSpans.delete(oldKey); this.activeSpans.set(formatSkillReference(this.getSkillReference(skill)), span); }
    }
  }

  async refreshAdaptiveCatalog(): Promise<void> {
    await this.snapshotCatalog.refresh();
    if (this.snapshotCatalog.managed) await this.loadFromDirectory(this.userSkillsDir, this.defaultSource, true);
  }

  getSkillReference(skill: SkillDefinition): SkillReference {
    const snapshotReference = this.snapshotCatalog.referenceFor(skill.path);
    if (snapshotReference) return snapshotReference;
    if (skill.reference) return skill.reference;
    const record = this.catalogDefinitions.get(skill.path);
    const root = record?.root ?? path.dirname(path.dirname(skill.path));
    const customAuthority = this.options.userSkillLocations?.find(location => sameResolvedPath(location.basePath, root))?.authority;
    const relativeRoot = this.workspaceRoot && skill.source.endsWith('-project') ? path.relative(this.workspaceRoot, root).split(path.sep).join('/') : undefined;
    const projectEcosystem = relativeRoot && relativeRoot !== '..' && !relativeRoot.startsWith('../') && !path.isAbsolute(relativeRoot)
      ? relativeRoot === 'skills' ? 'workspace' : relativeRoot.replace(/\/skills$/u, '').replace(/^\./u, '') : undefined;
    const ecosystem = projectEcosystem ?? (skill.source.startsWith('autohand') ? 'autohand'
      : skill.source.startsWith('codex') ? 'codex' : skill.source.startsWith('claude') ? 'claude'
      : path.basename(path.dirname(root)) === '.agent' ? 'agent' : 'agents');
    const packageId = path.relative(root, path.dirname(skill.path)).split(path.sep).join('/') || skill.name;
    if (customAuthority) return { authority: customAuthority, packageId };
    if (skill.source === 'builtin') return { authority: 'autohand:builtin', packageId };
    if (skill.source === 'community') return { authority: 'registry:agentskill', packageId: skill.metadata?.['agentskill-slug'] ?? packageId };
    if (skill.path.includes(`${path.sep}.account-skills${path.sep}`)) {
      return { authority: `account:${path.basename(path.dirname(path.dirname(skill.path)))}`, packageId: path.basename(path.dirname(skill.path)) };
    }
    if (skill.source === 'extension') return { authority: `extension:${skill.metadata?.['extension-id'] ?? path.basename(root)}`, packageId };
    return { authority: skill.source.endsWith('-project') ? `local:workspace:${this.workspaceIdentity ?? 'unresolved'}:${ecosystem}` : `local:personal:${ecosystem}`, packageId };
  }

  async setLearnedCandidates(candidates: readonly LearnedSkillCandidate[]): Promise<void> {
    const next = new Map<string, { skill: SkillDefinition; candidate: LearnedSkillCandidate }>();
    for (const candidate of candidates) {
      if (!['draft', 'verified', 'preferred'].includes(candidate.status)) continue;
      if (candidate.scope !== 'user' && candidate.scope !== `project:${this.workspaceIdentity}`) continue;
      const filename = path.join(candidate.packagePath, 'SKILL.md');
      const prior = this.learnedSkills.get(filename);
      const parsed = prior && formatSkillReference(prior.candidate.reference) === formatSkillReference(candidate.reference)
        ? { success: true, skill: prior.skill }
        : await this.parser.parseFile(filename, candidate.scope === 'user' ? 'autohand-user' : 'autohand-project');
      if (!parsed.success || !parsed.skill) continue;
      parsed.skill.reference = { ...candidate.reference };
      this.learnedMetadata.set(parsed.skill, candidate);
      next.set(filename, { skill: parsed.skill, candidate });
    }
    for (const [filename, { skill }] of this.learnedSkills) {
      if (!next.has(filename)) { this.closeSpan(formatSkillReference(this.getSkillReference(skill)), 'deactivated'); skill.isActive = false; }
    }
    this.learnedSkills = next;
  }

  getCatalogSkills(): SkillDefinition[] {
    const preferred = this.listSkills();
    const seen = new Set(preferred.map(skill => skill.path));
    const base = [...preferred, ...[...this.catalogDefinitions.values()].map(record => record.skill)
      .filter(skill => !seen.has(skill.path))].filter(skill => this.isSnapshotAuthorized(skill));
    const excluded = this.options.getAdaptiveSettings?.()?.excluded ?? [];
    const authorized = (skill: SkillDefinition): boolean => !excluded.includes(skill.name)
      && !excluded.includes(formatSkillReference(this.getSkillReference(skill)))
      && !excluded.includes(formatSkillReference({ ...this.getSkillReference(skill), revision: undefined, resource: undefined }));
    const learned = [...this.learnedSkills.values()];
    const allowed = (record: (typeof learned)[number], visited = new Set<string>()): boolean => {
      const { candidate, skill } = record;
      if (visited.has(candidate.id) || !authorized(skill)
        || (candidate.scope !== 'user' && candidate.scope !== `project:${this.workspaceIdentity}`)) return false;
      if (!candidate.parent) return true;
      const sameIdentity = (entry: SkillDefinition): boolean => {
        const ref = this.getSkillReference(entry);
        return ref.authority === candidate.parent!.authority && ref.packageId === candidate.parent!.packageId;
      };
      if (base.some(entry => sameIdentity(entry) && authorized(entry))) return true;
      const parent = learned.find(entry => sameIdentity(entry.skill));
      return !!parent && allowed(parent, new Set([...visited, candidate.id]));
    };
    return [...base, ...learned.filter(record => allowed(record) && this.isSnapshotAuthorized(record.skill)).map(record => record.skill)];
  }

  private isSnapshotAuthorized(skill: SkillDefinition): boolean {
    if (!this.snapshotCatalog.managed || skill.source === 'builtin') return true;
    const scope = this.snapshotCatalog.scopeFor(skill.path);
    return !!scope && (!scope.startsWith('project:') || scope === `project:${this.workspaceIdentity ?? 'unresolved'}`);
  }

  getSkillRuntime(): SkillRuntime {
    this.canonicalRuntime ??= new SkillRuntime({
      catalog: () => this.getCatalogSkills().map(skill => {
        let entry = this.catalogEntries.get(skill);
        if (!entry) {
          entry = { name: skill.name, description: skill.description, source: skill.source, reference: this.getSkillReference(skill),
            scope: 'personal', root: path.dirname(skill.path), enabled: true };
          this.catalogEntries.set(skill, entry);
        }
        entry.reference = this.getSkillReference(skill);
        entry.scope = skill.source === 'builtin' ? 'builtin' : skill.source.endsWith('-project') ? `project:${this.workspaceIdentity ?? 'unresolved'}` : 'personal';
        entry.scope = this.snapshotCatalog.scopeFor(skill.path) ?? entry.scope;
        const learned = this.learnedMetadata.get(skill);
        if (learned) {
          entry.scope = learned.scope === 'user' ? 'personal' : learned.scope;
          entry.quality = learned.status as 'draft' | 'verified' | 'preferred';
          entry.automatic = learned.status !== 'draft';
          entry.preference = learned.status === 'preferred' && learned.benefit ? 0.05 : 0;
        }
        entry.name = skill.name; entry.description = skill.description;
        const exclusions = this.options.getAdaptiveSettings?.()?.excluded ?? [];
        entry.enabled = !exclusions.includes(skill.name) && !exclusions.includes(formatSkillReference(entry.reference));
        return entry;
      }),
      authorizedScopes: () => this.snapshotCatalog.managed
        ? new Set(['builtin', ...this.snapshotCatalog.authorizedScopes(this.workspaceIdentity ?? 'unresolved')])
        : new Set(['builtin', 'personal', `project:${this.workspaceIdentity ?? 'unresolved'}`]),
      revisionStore: new SkillRevisionStore(path.join(this.userSkillsDir, '.revisions')),
      resourceMaterializer: new SkillResourceMaterializer(path.join(path.dirname(this.userSkillsDir), '.skill-resources')),
    });
    return this.canonicalRuntime;
  }

  getActivationOrigin(skill: SkillDefinition): CapabilityUsageOrigin | undefined { return this.activationOrigins.get(skill); }
  getActivationReference(skill: SkillDefinition): SkillReference { return this.activationReferences.get(skill) ?? this.getSkillReference(skill); }

  getAdaptiveSession(): AdaptiveSkillSession {
    this.adaptiveSession ??= new AdaptiveSkillSession({ registry: this,
      rerank: request => this.adaptiveRerank?.(request) ?? Promise.resolve(null) });
    return this.adaptiveSession;
  }

  setAdaptiveRerank(rerank: AdaptiveSkillSessionOptions['rerank']): void { this.adaptiveRerank = rerank; }

  /** Replace the ephemeral skills contributed by the current extension snapshot. */
  setExtensionSkills(contributions: ExtensionSkillContribution[]): void {
    const previous = new Map([...this.catalogDefinitions.values()]
      .filter(record => record.skill.source === 'extension')
      .map(({ skill }) => [formatSkillReference(this.getSkillReference(skill)), {
        active: skill.isActive,
        origin: this.activationOrigins.get(skill),
        reference: this.activationReferences.get(skill),
      }]));
    for (const [filename, { skill }] of this.catalogDefinitions) {
      if (skill.source === 'extension') {
        skill.isActive = false;
        this.catalogDefinitions.delete(filename);
      }
    }
    for (const name of this.extensionSkillNames) {
      if (this.skills.get(name)?.source === 'extension') {
        this.skills.delete(name);
      }
    }
    this.extensionSkillNames.clear();

    for (const contribution of contributions) {
      const name = contribution.definition.name;
      const root = contribution.provenance.packageRoot;
      const reference: SkillReference = {
        authority: `extension:${contribution.provenance.extensionId}`,
        packageId: path.relative(root, path.dirname(contribution.provenance.file)).split(path.sep).join('/') || name,
      };
      const retained = previous.get(formatSkillReference(reference));
      const skill: SkillDefinition = {
        ...contribution.definition,
        source: 'extension',
        path: contribution.provenance.file,
        reference,
        isActive: retained?.active ?? false,
      };
      this.catalogDefinitions.set(skill.path, { skill, root });
      if (retained?.origin) this.activationOrigins.set(skill, retained.origin);
      if (retained?.reference) this.activationReferences.set(skill, retained.reference);
      if (!this.skills.has(name)) {
        this.skills.set(name, skill);
        this.extensionSkillNames.add(name);
      }
    }
  }

  /** Activate exact `$skill-name` mentions and return their same-turn instructions. */
  activateMentionedSkills(instruction: string): SkillDefinition[] {
    const mentioned: SkillDefinition[] = [];
    const seen = new Set<string>();
    for (const match of instruction.matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
      const name = match[1];
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      // getSkill, not this.skills: account-managed skills live only in the
      // account snapshot, and a mention must activate (and report) them too.
      const skill = this.getSkill(name);
      if (!skill) {
        continue;
      }
      this.activateSkill(name);
      skill.isActive = true;
      mentioned.push(skill);
    }
    return mentioned;
  }

  /**
   * Initialize the registry by loading skills from the user directory
   */
  async initialize(): Promise<void> {
    await this.snapshotCatalog.refresh();
    await this.loadBuiltins();

    for (const location of this.getUserSkillLocations()) {
      await this.loadFromDirectory(location.basePath, location.source, location.recursive);
    }
  }

  private async loadBuiltins(): Promise<void> {
    for (const directory of this.getBuiltinSkillDirectories()) {
      if (await fs.pathExists(directory)) {
        await this.loadFromDirectory(directory, 'builtin', true);
        return;
      }
    }

    // A compiled binary ships no skills/builtin directory; use the embedded copy.
    const embeddedDirectory = await resolveEmbeddedBuiltinAssetDirectory('skills', {
      root: this.options.embeddedBuiltinAssetsRoot,
    });
    await this.loadFromDirectory(embeddedDirectory, 'builtin', true);
  }

  private getBuiltinSkillDirectories(): string[] {
    if (this.options.builtinSkillDirectories) {
      return this.options.builtinSkillDirectories;
    }
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    return [
      path.join(moduleDir, BUILTIN_SKILLS_DIR),
      path.join(moduleDir, 'skills', BUILTIN_SKILLS_DIR),
      path.join(moduleDir, '..', 'skills', BUILTIN_SKILLS_DIR),
    ];
  }

  private getUserSkillLocations(): SkillSearchLocation[] {
    if (this.snapshotCatalog.managed) return [{ basePath: this.userSkillsDir, source: this.defaultSource, recursive: true }];
    if (this.options.userSkillLocations) {
      return this.options.userSkillLocations;
    }

    const includeDefaultLocations = this.options.includeDefaultUserSkillLocations
      ?? sameResolvedPath(this.userSkillsDir, AUTOHAND_PATHS.skills);

    if (!includeDefaultLocations) {
      return [{ basePath: this.userSkillsDir, source: this.defaultSource, recursive: true }];
    }

    return createDefaultUserSkillLocations(
      this.userSkillsDir,
      this.defaultSource,
      this.options.homeDir
    );
  }

  /**
   * Set the workspace root and load project-level skills
   */
  async setWorkspace(workspaceRoot: string, options: { createIdentity?: boolean } = {}): Promise<void> {
    if (this.workspaceRoot !== workspaceRoot) {
      for (const [filename, record] of this.catalogDefinitions) {
        if (record.skill.source.endsWith('-project')) {
          this.closeSpan(formatSkillReference(this.getSkillReference(record.skill)), 'deactivated');
          this.catalogDefinitions.delete(filename);
        }
      }
      this.skills.clear();
      for (const { skill } of this.catalogDefinitions.values()) this.skills.set(skill.name, skill);
      this.adaptiveSession?.reset();
    }
    this.workspaceRoot = workspaceRoot;
    this.workspaceIdentity = null;
    if (this.options.adaptiveEnabled?.()) {
      if (options.createIdentity === false) this.workspaceIdentity = await readSkillWorkspaceIdentity(workspaceRoot);
      else await this.ensureAdaptiveWorkspace();
    }

    for (const location of getProjectSkillLocations(workspaceRoot)) {
      await this.loadFromDirectory(location.basePath, location.source, location.recursive);
    }
  }

  /**
   * Add an additional skill location to search
   */
  async addLocation(directory: string, source: SkillSource, recursive = true): Promise<void> {
    await this.loadFromDirectory(directory, source, recursive);
  }

  /**
   * Add a skill location with auto-copy to autohand location
   * Copies discovered skills to the target autohand directory, preserving structure
   */
  async addLocationWithAutoCopy(
    sourceDirectory: string,
    source: SkillSource,
    targetAutohandDir: string,
    recursive = true
  ): Promise<SkillCopyResult> {
    const result: SkillCopyResult = {
      copiedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      copiedSkills: [],
      skippedSkills: [],
    };

    if (!(await fs.pathExists(sourceDirectory))) {
      return result;
    }

    // Find all skill files
    const skillFiles = await this.findSkillFiles(sourceDirectory, recursive);

    for (const skillPath of skillFiles) {
      // Parse the skill to get its info
      const parseResult = await this.parser.parseFile(skillPath, source);
      if (!parseResult.success || !parseResult.skill) {
        continue;
      }

      const skill = parseResult.skill;
      const skillName = skill.name;

      // Determine the relative path from source directory to the skill's parent directory
      const skillDir = path.dirname(skillPath);
      const relativePath = path.relative(sourceDirectory, skillDir);

      // Target path in autohand directory
      const targetSkillDir = path.join(targetAutohandDir, relativePath);
      const targetSkillPath = path.join(targetSkillDir, 'SKILL.md');

      // Check if skill already exists in target
      if (await fs.pathExists(targetSkillPath)) {
        result.skippedCount++;
        result.skippedSkills.push(skillName);
      } else {
        try {
          // Copy the skill file
          await fs.ensureDir(targetSkillDir);
          await fs.copyFile(skillPath, targetSkillPath);
          result.copiedCount++;
          result.copiedSkills.push(skillName);
        } catch {
          result.errorCount++;
        }
      }

      // Register the skill (later source overrides earlier)
      this.registerSkill(skill, sourceDirectory);
    }

    return result;
  }

  /**
   * Set workspace with auto-copy from claude-project to autohand-project
   */
  async setWorkspaceWithAutoCopy(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;

    // Load and copy Claude project skills to Autohand project
    const claudeProjectSkillsDir = path.join(workspaceRoot, '.claude', 'skills');
    const autohandProjectSkillsDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills');

    await this.addLocationWithAutoCopy(
      claudeProjectSkillsDir,
      'claude-project',
      autohandProjectSkillsDir,
      false // Claude project is not recursive
    );

    // Load Autohand project skills (recursive, no copy needed)
    await this.loadFromDirectory(autohandProjectSkillsDir, 'autohand-project', true);
  }

  /**
   * Add a skill location with auto-copy AND backup to community API
   * Enhanced version that also backs up vendor skills to the API
   */
  async addLocationWithAutoCopyAndBackup(
    sourceDirectory: string,
    source: SkillSource,
    targetAutohandDir: string,
    recursive = true
  ): Promise<SkillCopyResult> {
    // First, perform the standard copy
    const result = await this.addLocationWithAutoCopy(
      sourceDirectory,
      source,
      targetAutohandDir,
      recursive
    );

    // Then backup copied skills to community API if client is available
    if (this.communityClient && result.copiedCount > 0) {
      const backupPayloads: BackupPayload[] = [];

      for (const skillName of result.copiedSkills) {
        const skill = this.skills.get(skillName);
        if (skill) {
          backupPayloads.push({
            name: skill.name,
            description: skill.description,
            body: skill.body,
            allowedTools: skill['allowed-tools'],
            originalSource: source,
            originalPath: skill.path,
          });
        }
      }

      // Backup all at once (or queue if offline)
      if (backupPayloads.length > 0) {
        await this.communityClient.backupAllSkills(backupPayloads);
      }
    }

    return result;
  }

  /**
   * Backup all vendor skills to community API
   */
  async backupAllVendorSkills(): Promise<{ backed: number; failed: number }> {
    if (!this.communityClient) {
      return { backed: 0, failed: 0 };
    }

    const vendorSkills = this.getVendorSkills();
    if (vendorSkills.length === 0) {
      return { backed: 0, failed: 0 };
    }

    const payloads: BackupPayload[] = vendorSkills.map(skill => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      allowedTools: skill['allowed-tools'],
      originalSource: skill.source,
      originalPath: skill.path,
    }));

    return this.communityClient.backupAllSkills(payloads);
  }

  /**
   * Load skills from a directory
   */
  private async loadFromDirectory(
    directory: string,
    source: SkillSource,
    recursive: boolean
  ): Promise<void> {
    if (!(await fs.pathExists(directory))) {
      return;
    }

    const skillFiles = await this.findSkillFiles(directory, recursive);

    for (const skillPath of skillFiles) {
      const snapshot = this.snapshotCatalog.referenceFor(skillPath);
      if (this.snapshotCatalog.managed && source !== 'builtin') {
        if (!snapshot) continue;
        const previous = this.catalogDefinitions.get(skillPath)?.skill;
        if (previous?.reference && formatSkillReference(previous.reference) === formatSkillReference(snapshot)) continue;
      }
      const result = await this.parser.parseFile(skillPath, source);
      if (result.success && result.skill) {
        if (snapshot) result.skill.reference = snapshot;
        // Later sources override earlier ones with the same name
        this.registerSkill(result.skill, directory);
      }
    }
  }

  /**
   * Find all SKILL.md files in a directory
   */
  private async findSkillFiles(directory: string, recursive: boolean): Promise<string[]> {
    const results: string[] = [];

    if (!(await fs.pathExists(directory))) {
      return results;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // Check for SKILL.md in this subdirectory
        const skillPath = path.join(fullPath, 'SKILL.md');
        if (await fs.pathExists(skillPath)) {
          results.push(skillPath);
        }

        // Recursively search if enabled
        if (recursive) {
          const nested = await this.findSkillFiles(fullPath, true);
          results.push(...nested);
        }
      }
    }

    return results;
  }

  /**
   * List all available skills
   */
  listSkills(): SkillDefinition[] {
    const account = readAccountSkills(path.dirname(this.userSkillsDir), this.options.accountConfigPath);
    return [...Array.from(this.skills.values()).filter(skill => !account.names.has(skill.name)), ...account.enabled]
      .filter(skill => this.isSnapshotAuthorized(skill));
  }

  /**
   * Get a specific skill by name
   */
  getSkill(name: string): SkillDefinition | null {
    if (parseSkillReference(name)) {
      const entry = this.getSkillRuntime().resolve(name);
      return entry ? this.getCatalogSkills().find(skill => path.dirname(skill.path) === entry.root
        && formatSkillReference(this.getSkillReference(skill)) === formatSkillReference(entry.reference)) ?? null : null;
    }
    const preferred = this.listSkills().find(skill => skill.name === name);
    const account = readAccountSkills(path.dirname(this.userSkillsDir), this.options.accountConfigPath);
    const skill = preferred ?? (!account.names.has(name)
      ? this.getCatalogSkills().find(candidate => candidate.name === name && this.learnedMetadata.has(candidate))
      : null) ?? null;
    if (skill && this.options.adaptiveEnabled?.() && !this.getSkillRuntime().resolve(this.getSkillReference(skill))) return null;
    return skill;
  }

  /**
   * Track a skill event via the telemetry manager.
   * Safe to call even without a telemetry manager configured.
   */
  trackSkillEvent(data: SkillUseData): void {
    this.telemetryManager?.trackSkillUse(data).catch(() => {});
  }

  /**
   * Activate a skill by name
   */
  activateSkill(name: string, origin: CapabilityUsageOrigin = 'user'): boolean {
    const skill = this.getSkill(name);
    if (!skill) {
      return false;
    }
    if (origin === 'agent' && this.learnedMetadata.get(skill)?.status === 'draft') return false;

    // Re-activating an already-active skill reports nothing: a second
    // activate would open a span nothing ever closes, and an unclosed span
    // can be neither priced nor judged.
    const spanKey = formatSkillReference(this.getSkillReference(skill));
    this.activationOrigins.set(skill, origin);
    this.activationReferences.set(skill, parseSkillReference(name) ?? this.getSkillReference(skill));
    if (this.activeSpans.has(spanKey)) {
      skill.isActive = true;
      return true;
    }

    skill.isActive = true;
    const spanId = randomUUID();
    this.activeSpans.set(spanKey, spanId);
    const file = describeSkillFile(skill.path);
    this.trackSkillEvent({
      skillName: name,
      source: skill.source,
      activationType: origin === 'agent' ? 'auto' : 'explicit',
      action: 'activate',
      spanId,
      // The body as injected, not the whole file: frontmatter never reaches
      // the prompt, so charging for it would overstate every skill by a
      // constant. `sizeBytes` carries the file for age and drift questions.
      tokenSize: estimateTokens(skill.body ?? ''),
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      modifiedAt: file.modifiedAt,
      version: skill.metadata?.version,
    });
    const recorder = this.capabilityUsageRecorder;
    if (!recorder) {
      return true;
    }
    try {
      const write = Promise.resolve(recorder({
        kind: 'skill',
        name,
        source: skill.source,
        origin,
        outcome: 'activated',
      }))
        .catch(() => {})
        .finally(() => {
          this.capabilityUsageWrites.delete(write);
        });
      this.capabilityUsageWrites.add(write);
    } catch {
      // Capability learning is best-effort and must not block skill activation.
    }
    return true;
  }

  /**
   * Deactivate a skill by name
   */
  deactivateSkill(name: string): boolean {
    const skill = this.getSkill(name);
    if (!skill) {
      return false;
    }

    skill.isActive = false;
    this.closeSpan(name, 'deactivated');
    return true;
  }

  /**
   * Deactivate all active skills.
   *
   * `reason` separates a session ending from a deliberate deactivation. Both
   * cost the same but mean different things: a skill released at session end
   * rode along for the whole run, one deactivated mid-session did not.
   */
  deactivateAll(reason: 'deactivated' | 'session_end' | 'compacted_out' = 'deactivated'): void {
    for (const skill of this.getCatalogSkills()) {
      skill.isActive = false;
    }
    for (const name of [...this.activeSpans.keys()]) {
      this.closeSpan(name, reason);
    }
  }

  /**
   * Reconcile open spans against what the context still carries, and report
   * the ones that survive.
   *
   * Called when the context is compacted. A skill costs its size times the
   * number of requests that carried it, so a span left open after its skill
   * stopped being sent keeps charging rent for text no longer in the prompt.
   *
   * An active skill survives: its body is re-rendered into the system prompt
   * on every request, and every compaction path here protects the system
   * message at index 0. What does not survive is a span whose skill is no
   * longer injected at all, which today means an extension dropping out of
   * its snapshot: `setExtensionSkills` deletes the skill and leaves the span
   * open. This is the first point in the session that notices.
   */
  noteContextCompaction(): string[] {
    const surviving: string[] = [];
    for (const [name, spanId] of [...this.activeSpans]) {
      if (this.getSkill(name)?.isActive === true) {
        surviving.push(spanId);
        continue;
      }
      this.closeSpan(name, 'compacted_out');
    }
    return surviving;
  }

  /**
   * Closes a skill's span. Silent when none is open, so deactivating a skill
   * that was never activated reports nothing rather than a release with no
   * matching activate.
   */
  private closeSpan(name: string, reason: 'deactivated' | 'session_end' | 'compacted_out'): void {
    const skill = this.getSkill(name);
    const key = skill ? formatSkillReference(this.getSkillReference(skill)) : name;
    const spanId = this.activeSpans.get(key);
    if (!spanId) {
      return;
    }
    this.activeSpans.delete(key);
    this.trackSkillEvent({
      skillName: skill?.name ?? name,
      source: this.getSkill(name)?.source ?? 'unknown',
      activationType: 'explicit',
      action: 'release',
      spanId,
      releaseReason: reason,
    });
  }

  /**
   * Get all currently active skills
   */
  getActiveSkills(): SkillDefinition[] {
    return this.getCatalogSkills().filter(s => s.isActive);
  }

  /**
   * Find skills similar to a given query using Jaccard similarity
   */
  findSimilar(query: string, threshold = SIMILARITY_THRESHOLD): SkillSimilarityMatch[] {
    const queryTokens = this.tokenize(query);
    const matches: SkillSimilarityMatch[] = [];

    for (const skill of this.listSkills()) {
      // Combine name and description for similarity matching
      const skillText = `${skill.name} ${skill.description}`;
      const skillTokens = this.tokenize(skillText);

      const score = this.calculateJaccard(queryTokens, skillTokens);
      if (score >= threshold) {
        matches.push({ skill, score });
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate Jaccard similarity between two token sets
   */
  private calculateJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }

    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize text into a set of lowercase words
   */
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
    );
  }

  /**
   * Get the number of loaded skills
   */
  get size(): number {
    return this.listSkills().length;
  }

  /**
   * Check if a skill exists by name
   */
  hasSkill(name: string): boolean {
    return this.getSkill(name) !== null;
  }

  /**
   * Save a new skill to the user skills directory
   */
  async saveSkill(name: string, content: string): Promise<boolean> {
    const skillDir = path.join(this.userSkillsDir, name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      await fs.ensureDir(skillDir);
      await fs.writeFile(skillPath, content, 'utf-8');

      // Parse and add to registry
      const result = await this.parser.parseFile(skillPath, 'autohand-user');
      if (result.success && result.skill) {
        this.registerSkill(result.skill);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Size and timestamps of a skill's source file, for ageing a skill and
 * spotting one that has drifted from what its author last touched.
 *
 * Read synchronously because activation is a user or agent action, not a hot
 * path, and threading an async stat through it would be a worse trade. Every
 * field is undefined when the file cannot be read — a zero size would read
 * as an empty skill, which is a measured claim about a file nobody opened.
 */
function describeSkillFile(filePath: string | undefined): {
  sizeBytes?: number;
  createdAt?: string;
  modifiedAt?: string;
} {
  if (!filePath) return {};
  try {
    const stats = statSync(filePath);
    return {
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {};
  }
}
