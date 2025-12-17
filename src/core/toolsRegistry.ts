/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import type { ToolRegistryEntry } from '../types.js';
import type { ToolDefinition } from './toolManager.js';
import { AUTOHAND_PATHS } from '../constants.js';

export interface MetaToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string;
  createdAt: string;
  source: 'agent' | 'user';
}

export class ToolsRegistry {
  private metaToolCache: Map<string, MetaToolDefinition> = new Map();

  constructor(private readonly toolsDir = AUTOHAND_PATHS.tools) { }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.toolsDir);
    await this.loadMetaToolDefinitions();
  }

  async listTools(builtIns: ToolDefinition[]): Promise<ToolRegistryEntry[]> {
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

    for (const [name, tool] of this.metaToolCache) {
      if (seen.has(name)) {
        continue;
      }
      entries.push({
        name: tool.name,
        description: tool.description,
        source: 'meta'
      });
      seen.add(name);
    }

    return entries;
  }

  async saveMetaTool(definition: Omit<MetaToolDefinition, 'createdAt'>): Promise<MetaToolDefinition> {
    const fullDef: MetaToolDefinition = {
      ...definition,
      createdAt: new Date().toISOString()
    };

    const filePath = path.join(this.toolsDir, `${definition.name}.json`);
    await fs.writeJson(filePath, fullDef, { spaces: 2 });
    this.metaToolCache.set(definition.name, fullDef);

    return fullDef;
  }

  getMetaTool(name: string): MetaToolDefinition | undefined {
    return this.metaToolCache.get(name);
  }

  hasMetaTool(name: string): boolean {
    return this.metaToolCache.has(name);
  }

  getAllMetaTools(): MetaToolDefinition[] {
    return Array.from(this.metaToolCache.values());
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
    try {
      const exists = await fs.pathExists(this.toolsDir);
      if (!exists) {
        return;
      }

      const files = await fs.readdir(this.toolsDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const fullPath = path.join(this.toolsDir, file);
        try {
          const data = await fs.readJson(fullPath);
          if (this.isValidMetaTool(data)) {
            this.metaToolCache.set(data.name, data);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Tools directory doesn't exist yet
    }
  }

  private isValidMetaTool(candidate: unknown): candidate is MetaToolDefinition {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const value = candidate as Record<string, unknown>;
    return (
      typeof value.name === 'string' &&
      typeof value.description === 'string' &&
      typeof value.handler === 'string' &&
      typeof value.parameters === 'object'
    );
  }
}
