/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolDefinition } from '../toolManager.js';
import { ToolsRegistry } from '../toolsRegistry.js';
import {
  type MetaToolCreateInput,
  type MetaToolDefinition,
  MetaToolCreateInputSchema,
  fingerprintMetaTool,
} from './schema.js';
import { assertSafeMetaToolHandler } from './safety.js';

export interface CreateMetaToolResult {
  status: 'created' | 'existing';
  definition: MetaToolDefinition;
  message: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'by', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with',
  'find', 'search', 'list', 'get', 'show', 'analyze', 'count', 'run', 'quick',
  'tool', 'tools', 'file', 'files', 'codebase', 'workspace', 'source', 'across',
]);

function normalizeHandler(handler: string): string {
  return handler.trim().replace(/\s+/g, ' ');
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.endsWith('s') ? token.slice(0, -1) : token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection++;
    }
  }
  return intersection / Math.min(left.size, right.size);
}

function isSimilarTool(candidate: MetaToolCreateInput, existing: Pick<ToolDefinition, 'name' | 'description'>): boolean {
  const candidateNameTokens = tokenize(candidate.name);
  const existingNameTokens = tokenize(existing.name);
  if (overlapRatio(candidateNameTokens, existingNameTokens) >= 0.75) {
    return true;
  }

  const candidateDescriptionTokens = tokenize(candidate.description);
  const existingDescriptionTokens = tokenize(existing.description ?? '');
  return overlapRatio(candidateDescriptionTokens, existingDescriptionTokens) >= 0.75;
}

export class MetaToolService {
  constructor(private readonly registry: ToolsRegistry) {}

  async createMetaTool(input: unknown, registeredTools: ToolDefinition[]): Promise<CreateMetaToolResult> {
    const parsed = MetaToolCreateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid meta-tool definition: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
    }

    const definitionInput = parsed.data;
    assertSafeMetaToolHandler(definitionInput.handler);

    const fingerprint = fingerprintMetaTool(definitionInput);
    const existingByName = this.registry.getMetaTool(definitionInput.name);
    if (existingByName) {
      if (existingByName.fingerprint === fingerprint) {
        return {
          status: 'existing',
          definition: existingByName,
          message: `Meta-tool "${definitionInput.name}" already exists with the same definition.`,
        };
      }
      throw new Error(`Cannot create meta-tool "${definitionInput.name}": already exists with a different definition`);
    }

    const registeredNameConflict = registeredTools.find((tool) => tool.name === definitionInput.name);
    if (registeredNameConflict) {
      throw new Error(`Cannot create meta-tool "${definitionInput.name}": conflicts with existing tool`);
    }

    for (const existing of this.registry.getAllMetaTools()) {
      if (normalizeHandler(existing.handler) === normalizeHandler(definitionInput.handler)) {
        throw new Error(`Cannot create meta-tool "${definitionInput.name}": same handler already exists as "${existing.name}"`);
      }
    }

    const existingTools = [
      ...registeredTools,
      ...this.registry.getAllMetaTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
      } as ToolDefinition)),
    ];
    const similar = existingTools.find((tool) => tool.name !== definitionInput.name && isSimilarTool(definitionInput, tool));
    if (similar) {
      throw new Error(`Cannot create meta-tool "${definitionInput.name}": similar existing tool "${similar.name}" should be reused`);
    }

    const now = new Date().toISOString();
    const saved = await this.registry.saveMetaTool({
      ...definitionInput,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      fingerprint,
    });

    return {
      status: 'created',
      definition: saved,
      message: `Created meta-tool "${saved.name}" - available in this and future sessions`,
    };
  }

}
