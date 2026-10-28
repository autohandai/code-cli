/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import type { ToolRegistryEntry } from '../types.js';
import type { ToolDefinition } from './toolManager.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import {
  META_TOOL_NAME_PATTERN,
  type MetaToolDefinition,
  type MetaToolScope,
  fingerprintMetaTool,
  normalizeMetaToolDefinition
} from './metaTools/schema.js';
import { assertSafeMetaToolHandler } from './metaTools/safety.js';
import type { ExtensionProvenance, ExtensionToolContribution } from '../extensions/types.js';

export type { MetaToolDefinition } from './metaTools/schema.js';

export interface ToolsRegistryLocation {
  scope: MetaToolScope;
  dir: string;
}

export interface MetaToolDiagnostic {
  file: string;
  reason: string;
}

export interface MetaToolListOptions {
  includeDisabled?: boolean;
}

export interface ToolRegistryListOptions {
  includeDisabled?: boolean;
}

interface MetaToolRecord {
  definition: MetaToolDefinition;
  filePath: string;
}

interface ExtensionMetaToolRecord extends MetaToolRecord {
  provenance: ExtensionProvenance;
}

function locationKey(scope: MetaToolScope, name: string): string {
  return `${scope}:${name}`;
}

function normalizeLocations(input?: string | ToolsRegistryLocation[]): ToolsRegistryLocation[] {
  if (Array.isArray(input)) {
    return input;
  }
  return [{ scope: 'user', dir: input ?? AUTOHAND_PATHS.tools }];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ToolsRegistryOptions {
  /** Project (.autohand/tools) definitions load only when the workspace is trusted. Defaults to false. */
  projectToolsTrusted?: boolean;
}

const UNTRUSTED_PROJECT_TOOLS_REASON = 'project tools require a trusted workspace';
const SHADOW_REASON_PREFIX = 'project tool shadows ';

/** Active-cache precedence: a user tool always wins over a project tool of the same name. */
const META_TOOL_PRECEDENCE: readonly MetaToolScope[] = ['user', 'project'];

export function createToolsRegistry(
  workspaceRoot?: string,
  userToolsDir = AUTOHAND_PATHS.tools,
  options: ToolsRegistryOptions = {},
): ToolsRegistry {
  const registry = new ToolsRegistry([{ scope: 'user', dir: userToolsDir }]);
  if (workspaceRoot) {
    const projectDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'tools');
    registry.addLocation({ scope: 'project', dir: projectDir });
    if (!options.projectToolsTrusted) {
      registry.noteUntrustedProjectTools(projectDir);
    }
  }
  return registry;
}

export class ToolsRegistry {
  private metaToolCache: Map<string, MetaToolDefinition> = new Map();
  private metaToolRecords: Map<string, MetaToolRecord> = new Map();
  private diagnostics: MetaToolDiagnostic[] = [];
  private extensionToolRecords: Map<string, ExtensionMetaToolRecord> = new Map();
  private reservedBuiltInNames: Set<string> = new Set();
  private untrustedProjectToolsDir?: string;

  constructor(locations?: string | ToolsRegistryLocation[]) {
    this.locations = normalizeLocations(locations);
  }

  private locations: ToolsRegistryLocation[];

  addLocation(location: ToolsRegistryLocation): void {
    this.locations.push(location);
  }

  /** Remember a project tools directory that was skipped because the workspace is untrusted. */
  noteUntrustedProjectTools(dir: string): void {
    this.untrustedProjectToolsDir = dir;
  }

  /** Built-in tool names a project tool may never take; idempotent. */
  reserveBuiltInNames(names: Iterable<string>): void {
    for (const name of names) this.reservedBuiltInNames.add(name);
    this.rebuildActiveCache();
  }

  async initialize(): Promise<void> {
    this.metaToolCache.clear();
    this.metaToolRecords.clear();
    this.diagnostics = [];
    for (const location of this.locations) {
      if (this.isLoadableLocation(location)) await fs.ensureDir(location.dir);
    }
    await this.loadMetaToolDefinitions();
  }

  async listTools(builtIns: ToolDefinition[]): Promise<ToolRegistryEntry[]> {
    // Keeps getMetaTool consistent with what the agent advertises as built-in.
    this.reserveBuiltInNames(builtIns.map((tool) => tool.name));
    const seen = new Set<string>();
    const entries: ToolRegistryEntry[] = [];

    for (const def of builtIns) {
      if (seen.has(def.name)) {
        continue;
      }
      entries.push({
        name: def.name,
        description: def.description,
        requiresApproval: def.requiresApproval,
        approvalMessage: def.approvalMessage,
        source: 'builtin'
      });
      seen.add(def.name);
    }

    for (const entry of this.getRegistryEntries()) {
      if (seen.has(entry.name)) {
        continue;
      }
      entries.push(entry);
      seen.add(entry.name);
    }

    return entries;
  }

  getRegistryEntries(options: ToolRegistryListOptions = {}): ToolRegistryEntry[] {
    const records: Array<{ definition: MetaToolDefinition; provenance?: ExtensionProvenance }> = [];

    if (options.includeDisabled) {
      for (const location of this.locations) {
        const scopedRecords = Array.from(this.metaToolRecords.values())
          .filter((record) => record.definition.scope === location.scope)
          .sort((left, right) => left.definition.name.localeCompare(right.definition.name));
        records.push(...scopedRecords.map((record) => ({ definition: record.definition })));
      }
      records.push(...Array.from(this.extensionToolRecords.values())
        .sort((left, right) => left.definition.name.localeCompare(right.definition.name))
        .map((record) => ({ definition: record.definition, provenance: record.provenance })));
    } else {
      records.push(...Array.from(this.metaToolCache.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, definition]) => ({
          definition,
          provenance: this.extensionToolRecords.get(name)?.provenance,
        })));
    }

    return records.map(({ definition, provenance }) => ({
      name: definition.name,
      description: definition.description,
      source: provenance ? 'extension' : 'meta',
      scope: definition.scope,
      disabled: definition.disabled,
      createdAt: definition.createdAt,
      schemaVersion: definition.schemaVersion,
      handlerPreview: definition.handler.length > 140
        ? `${definition.handler.slice(0, 137)}...`
        : definition.handler,
      reuseHint: `Use ${definition.name} instead of creating another tool for: ${definition.description}`,
      extensionId: provenance?.extensionId,
      extensionVersion: provenance?.extensionVersion,
    }));
  }

  async saveMetaTool(definition: MetaToolDefinition): Promise<MetaToolDefinition> {
    const fullDef = normalizeMetaToolDefinition(definition);
    if (!fullDef) {
      throw new Error(`Invalid meta-tool definition for "${definition.name}"`);
    }
    assertSafeMetaToolHandler(fullDef.handler);

    const location = this.getLocationForScope(fullDef.scope);
    const filePath = path.join(location.dir, `${fullDef.name}.json`);
    const release = await this.acquireLock(location.dir, fullDef.name);
    try {
      const existing = await this.readDefinition(filePath);
      if (existing) {
        if (existing.fingerprint === fullDef.fingerprint) {
          this.upsertRecord(existing, filePath);
          return existing;
        }
        throw new Error(`Meta-tool "${fullDef.name}" already exists in ${fullDef.scope} scope`);
      }
      await this.writeDefinition(filePath, fullDef);
    } finally {
      await release();
    }
    this.upsertRecord(fullDef, filePath);

    return fullDef;
  }

  getMetaTool(name: string): MetaToolDefinition | undefined {
    return this.metaToolCache.get(name);
  }

  getMetaToolProvenance(name: string): ExtensionProvenance | undefined {
    return this.extensionToolRecords.get(name)?.provenance;
  }

  setExtensionTools(contributions: ExtensionToolContribution[]): MetaToolDiagnostic[] {
    const nextRecords = new Map<string, ExtensionMetaToolRecord>();
    const diagnostics: MetaToolDiagnostic[] = [];
    const standaloneNames = new Set(
      Array.from(this.metaToolRecords.values()).map((record) => record.definition.name),
    );

    for (const contribution of contributions) {
      const { definition, provenance } = contribution;
      if (standaloneNames.has(definition.name)) {
        diagnostics.push({
          file: provenance.file,
          reason: `Extension tool "${definition.name}" conflicts with standalone meta-tool`,
        });
        continue;
      }
      if (nextRecords.has(definition.name)) {
        diagnostics.push({
          file: provenance.file,
          reason: `Extension tool "${definition.name}" conflicts with another extension tool`,
        });
        continue;
      }
      nextRecords.set(definition.name, {
        definition,
        filePath: provenance.file,
        provenance,
      });
    }

    this.extensionToolRecords = nextRecords;
    this.rebuildActiveCache();
    return diagnostics;
  }

  hasMetaTool(name: string): boolean {
    return this.metaToolCache.has(name);
  }

  getAllMetaTools(): MetaToolDefinition[] {
    return Array.from(this.metaToolCache.values());
  }

  listMetaTools(options: MetaToolListOptions = {}): MetaToolDefinition[] {
    if (!options.includeDisabled) {
      return this.getAllMetaTools();
    }
    return Array.from(this.metaToolRecords.values()).map((record) => record.definition);
  }

  getDiagnostics(): MetaToolDiagnostic[] {
    return [...this.diagnostics];
  }

  async deleteMetaTool(name: string, scope?: MetaToolScope): Promise<MetaToolDefinition> {
    const record = this.findRecord(name, scope);
    if (!record) {
      throw new Error(`Meta-tool "${name}" not found`);
    }
    await fs.remove(record.filePath);
    this.deleteRecord(record.definition);
    return record.definition;
  }

  async setMetaToolDisabled(name: string, disabled: boolean, scope?: MetaToolScope): Promise<MetaToolDefinition> {
    const record = this.findRecord(name, scope);
    if (!record) {
      throw new Error(`Meta-tool "${name}" not found`);
    }
    const updated = {
      ...record.definition,
      disabled,
      updatedAt: new Date().toISOString(),
    };
    await this.writeDefinition(record.filePath, updated);
    this.upsertRecord(updated, record.filePath);
    this.rebuildActiveCache();
    return updated;
  }

  async renameMetaTool(name: string, newName: string, scope?: MetaToolScope): Promise<MetaToolDefinition> {
    if (!META_TOOL_NAME_PATTERN.test(newName)) {
      throw new Error('new name must be snake_case and start with a lowercase letter');
    }
    const record = this.findRecord(name, scope);
    if (!record) {
      throw new Error(`Meta-tool "${name}" not found`);
    }
    if (this.findRecord(newName)) {
      throw new Error(`Meta-tool "${newName}" already exists`);
    }

    const renamed = {
      ...record.definition,
      name: newName,
      updatedAt: new Date().toISOString(),
    };
    const normalized = normalizeMetaToolDefinition({
      ...renamed,
      fingerprint: fingerprintMetaTool(renamed),
    });
    if (!normalized) {
      throw new Error(`Invalid meta-tool definition for "${newName}"`);
    }

    const location = this.getLocationForScope(normalized.scope);
    const nextFilePath = path.join(location.dir, `${newName}.json`);
    await this.writeDefinition(nextFilePath, normalized);
    await fs.remove(record.filePath);
    this.deleteRecord(record.definition);
    this.upsertRecord(normalized, nextFilePath);
    this.rebuildActiveCache();
    return normalized;
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.getAllMetaTools().map(tool => {
      // Meta-tools have dynamic names and parameters, cast the entire definition
      const params = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
      return {
        name: tool.name,
        description: tool.description,
        parameters: params.properties ? {
          type: 'object',
          properties: params.properties,
          required: params.required ?? []
        } : undefined
      } as ToolDefinition;
    });
  }

  private async loadMetaToolDefinitions(): Promise<void> {
    if (this.untrustedProjectToolsDir && (await fs.pathExists(this.untrustedProjectToolsDir))) {
      this.diagnostics.push({ file: this.untrustedProjectToolsDir, reason: UNTRUSTED_PROJECT_TOOLS_REASON });
    }
    for (const location of this.locations) {
      if (!this.isLoadableLocation(location)) continue;
      try {
        const exists = await fs.pathExists(location.dir);
        if (!exists) {
          continue;
        }

        const files = (await fs.readdir(location.dir)).sort((left, right) => left.localeCompare(right));

        for (const file of files) {
          if (!file.endsWith('.json')) {
            continue;
          }
          const fullPath = path.join(location.dir, file);
          try {
            const data = normalizeMetaToolDefinition({
              ...(await fs.readJson(fullPath)),
              scope: location.scope,
            });
            if (data) {
              assertSafeMetaToolHandler(data.handler);
              this.metaToolRecords.set(locationKey(data.scope, data.name), { definition: data, filePath: fullPath });
            } else {
              this.diagnostics.push({ file: fullPath, reason: 'invalid meta-tool definition' });
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'invalid meta-tool file';
            this.diagnostics.push({ file: fullPath, reason });
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'tools directory could not be read';
        this.diagnostics.push({ file: location.dir, reason });
      }
    }
    this.rebuildActiveCache();
  }

  private getLocationForScope(scope: MetaToolScope): ToolsRegistryLocation {
    const location = this.locations.find((candidate) => candidate.scope === scope);
    if (!location) {
      throw new Error(`No tools directory configured for ${scope} scope`);
    }
    return location;
  }

  private isLoadableLocation(location: ToolsRegistryLocation): boolean {
    return location.scope !== 'project' || location.dir !== this.untrustedProjectToolsDir;
  }

  private async readDefinition(filePath: string): Promise<MetaToolDefinition | null> {
    if (!await fs.pathExists(filePath)) {
      return null;
    }
    return normalizeMetaToolDefinition(await fs.readJson(filePath));
  }

  private async writeDefinition(filePath: string, definition: MetaToolDefinition): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.ensureDir(path.dirname(filePath));
      await fs.outputFile(tempPath, `${JSON.stringify(definition, null, 2)}\n`, { mode: 0o600 });
      const handle = await nodeFs.open(tempPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await nodeFs.rename(tempPath, filePath);
    } catch (error) {
      await fs.remove(tempPath).catch(() => {});
      throw error;
    }
  }

  private async acquireLock(dir: string, name: string): Promise<() => Promise<void>> {
    await fs.ensureDir(dir);
    const lockPath = path.join(dir, `${name}.lock`);
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const handle = await nodeFs.open(lockPath, 'wx', 0o600);
        await handle.close();
        return async () => {
          await fs.remove(lockPath).catch(() => {});
        };
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
        if (code === 'EEXIST') {
          await delay(25);
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Timed out waiting for meta-tool lock "${name}"`);
  }

  private upsertRecord(definition: MetaToolDefinition, filePath: string): void {
    this.metaToolRecords.set(locationKey(definition.scope, definition.name), { definition, filePath });
    this.rebuildActiveCache();
  }

  private deleteRecord(definition: MetaToolDefinition): void {
    this.metaToolRecords.delete(locationKey(definition.scope, definition.name));
    this.rebuildActiveCache();
  }

  private findRecord(name: string, scope?: MetaToolScope): MetaToolRecord | undefined {
    if (scope) {
      return this.metaToolRecords.get(locationKey(scope, name));
    }
    for (const location of this.locations) {
      const record = this.metaToolRecords.get(locationKey(location.scope, name));
      if (record) {
        return record;
      }
    }
    return undefined;
  }

  private rebuildActiveCache(): void {
    this.metaToolCache.clear();
    this.diagnostics = this.diagnostics.filter((d) => !d.reason.startsWith(SHADOW_REASON_PREFIX));
    for (const scope of META_TOOL_PRECEDENCE) {
      for (const record of this.metaToolRecords.values()) {
        if (record.definition.scope !== scope || record.definition.disabled) {
          continue;
        }
        const name = record.definition.name;
        if (scope === 'project' && this.reservedBuiltInNames.has(name)) {
          this.diagnostics.push({ file: record.filePath, reason: `${SHADOW_REASON_PREFIX}built-in tool "${name}"` });
          continue;
        }
        if (this.metaToolCache.has(name)) {
          if (scope === 'project') {
            this.diagnostics.push({ file: record.filePath, reason: `${SHADOW_REASON_PREFIX}user tool "${name}"` });
          }
          continue;
        }
        this.metaToolCache.set(name, record.definition);
      }
    }
    for (const [name, record] of this.extensionToolRecords) {
      if (!record.definition.disabled && !this.metaToolCache.has(name)) {
        this.metaToolCache.set(name, record.definition);
      }
    }
  }

}
