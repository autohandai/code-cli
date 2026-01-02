/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillsRegistry - Manages skill discovery, loading, and activation
 */
import fs from 'fs-extra';
import path from 'node:path';
import { SkillParser } from './SkillParser.js';
import type {
  SkillDefinition,
  SkillSource,
  SkillSimilarityMatch,
  SkillCopyResult,
} from './types.js';
import { PROJECT_DIR_NAME } from '../constants.js';
import type { TelemetryManager } from '../telemetry/TelemetryManager.js';
import type { CommunitySkillsClient, CommunitySkillPackage, BackupPayload } from './CommunitySkillsClient.js';

const SIMILARITY_THRESHOLD = 0.3;

/**
 * Registry for managing Agent Skills
 */
/** Vendor skill sources that indicate skills from codex/claude */
const VENDOR_SOURCES: SkillSource[] = ['codex-user', 'claude-user', 'codex-project', 'claude-project'];

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
  private parser = new SkillParser();
  private workspaceRoot: string | null = null;
  private readonly defaultSource: SkillSource;
  private telemetryManager: TelemetryManager | null = null;
  private communityClient: CommunitySkillsClient | null = null;

  constructor(
    private readonly userSkillsDir: string,
    defaultSource: SkillSource = 'autohand-user'
  ) {
    this.defaultSource = defaultSource;
  }

  /**
   * Set the telemetry manager for tracking skill events
   */
  setTelemetryManager(telemetryManager: TelemetryManager): void {
    this.telemetryManager = telemetryManager;
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
    if (!pkg.name || !pkg.body) {
      return { success: false, error: 'Invalid skill package: missing name or body' };
    }

    const skillDir = path.join(targetDir, pkg.name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    // Check if already exists
    if (await fs.pathExists(skillPath)) {
      return { success: false, skipped: true, error: 'Skill already exists' };
    }

    try {
      await fs.ensureDir(skillDir);
      await fs.writeFile(skillPath, pkg.body, 'utf-8');

      // Parse and register the skill
      const result = await this.parser.parseFile(skillPath, 'community');
      if (result.success && result.skill) {
        this.skills.set(result.skill.name, result.skill);
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
    if (!files.has('SKILL.md')) {
      return { success: false, error: 'Missing required SKILL.md file' };
    }

    const skillDir = path.join(targetDir, skillName);
    const skillPath = path.join(skillDir, 'SKILL.md');

    // Check if already exists (unless force is true)
    if (!force && (await fs.pathExists(skillPath))) {
      return { success: false, skipped: true, error: 'Skill already exists' };
    }

    try {
      // Remove existing skill directory if force is true
      if (force && (await fs.pathExists(skillDir))) {
        await fs.remove(skillDir);
      }

      // Write all files from the Map
      for (const [relativePath, content] of files) {
        const fullPath = path.join(skillDir, relativePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf-8');
      }

      // Parse and register the skill from SKILL.md
      const result = await this.parser.parseFile(skillPath, 'community');
      if (result.success && result.skill) {
        this.skills.set(result.skill.name, result.skill);
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
  isSkillInstalled(skillName: string, targetDir: string): Promise<boolean> {
    const skillPath = path.join(targetDir, skillName, 'SKILL.md');
    return fs.pathExists(skillPath);
  }

  /**
   * Get the user skills directory path
   */
  getUserSkillsDir(): string {
    return this.userSkillsDir;
  }

  /**
   * Initialize the registry by loading skills from the user directory
   */
  async initialize(): Promise<void> {
    await this.loadFromDirectory(this.userSkillsDir, this.defaultSource, true);
  }

  /**
   * Set the workspace root and load project-level skills
   */
  async setWorkspace(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;

    // Load Claude project skills (one level only)
    const claudeProjectSkillsDir = path.join(workspaceRoot, '.claude', 'skills');
    await this.loadFromDirectory(claudeProjectSkillsDir, 'claude-project', false);

    // Load Autohand project skills (recursive)
    const autohandProjectSkillsDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills');
    await this.loadFromDirectory(autohandProjectSkillsDir, 'autohand-project', true);
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
      this.skills.set(skill.name, skill);
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
      const result = await this.parser.parseFile(skillPath, source);
      if (result.success && result.skill) {
        // Later sources override earlier ones with the same name
        this.skills.set(result.skill.name, result.skill);
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
    return Array.from(this.skills.values());
  }

  /**
   * Get a specific skill by name
   */
  getSkill(name: string): SkillDefinition | null {
    return this.skills.get(name) ?? null;
  }

  /**
   * Activate a skill by name
   */
  activateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    skill.isActive = true;
    return true;
  }

  /**
   * Deactivate a skill by name
   */
  deactivateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    skill.isActive = false;
    return true;
  }

  /**
   * Deactivate all active skills
   */
  deactivateAll(): void {
    for (const skill of this.skills.values()) {
      skill.isActive = false;
    }
  }

  /**
   * Get all currently active skills
   */
  getActiveSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s => s.isActive);
  }

  /**
   * Find skills similar to a given query using Jaccard similarity
   */
  findSimilar(query: string, threshold = SIMILARITY_THRESHOLD): SkillSimilarityMatch[] {
    const queryTokens = this.tokenize(query);
    const matches: SkillSimilarityMatch[] = [];

    for (const skill of this.skills.values()) {
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
    return this.skills.size;
  }

  /**
   * Check if a skill exists by name
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
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
        this.skills.set(result.skill.name, result.skill);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
