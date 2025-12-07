/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { ToolRegistryEntry } from '../types.js';
import type { ToolDefinition } from './toolManager.js';

export class ToolsRegistry {
  constructor(private readonly toolsDir = path.join(os.homedir(), '.autohand-cli', 'tools')) { }

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

    const metaTools = await this.loadMetaTools();
    for (const tool of metaTools) {
      if (seen.has(tool.name)) {
        continue; // Do not override existing functionality
      }
      entries.push(tool);
      seen.add(tool.name);
    }

    return entries;
  }

  private async loadMetaTools(): Promise<ToolRegistryEntry[]> {
    try {
      const exists = await fs.pathExists(this.toolsDir);
      if (!exists) {
        return [];
      }

      const files = await fs.readdir(this.toolsDir);
      const tools: ToolRegistryEntry[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const fullPath = path.join(this.toolsDir, file);
        try {
          const data = await fs.readJson(fullPath);
          if (this.isValidTool(data)) {
            tools.push({ ...data, source: 'meta' });
          } else {
            console.warn(`Ignoring invalid meta tool in ${fullPath}`);
          }
        } catch (error) {
          console.warn(`Failed to read meta tool ${fullPath}: ${(error as Error).message}`);
        }
      }
      return tools;
    } catch (error) {
      console.warn(`Failed to load meta tools: ${(error as Error).message}`);
      return [];
    }
  }

  private isValidTool(candidate: unknown): candidate is Omit<ToolRegistryEntry, 'source'> {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const value = candidate as Record<string, unknown>;
    return typeof value.name === 'string' && typeof value.description === 'string';
  }
}
