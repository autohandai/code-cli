/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const META_TOOL_SCHEMA_VERSION = 1;
export const META_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const META_TOOL_SCOPES = ['user', 'project'] as const;

const JsonSchemaObject = z
  .record(z.string(), z.unknown())
  .refine((value) => value.type === 'object', 'parameters must be a JSON Schema object with type "object"');

export const MetaToolCreateInputSchema = z.object({
  name: z.string().trim().regex(META_TOOL_NAME_PATTERN, 'name must be snake_case and start with a lowercase letter'),
  description: z.string().trim().min(1).max(300),
  parameters: JsonSchemaObject,
  handler: z.string().trim().min(1).max(2000),
  source: z.enum(['agent', 'user']).default('agent'),
  scope: z.enum(META_TOOL_SCOPES).default('user'),
});

export const MetaToolDefinitionSchema = MetaToolCreateInputSchema.extend({
  schemaVersion: z.literal(META_TOOL_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  fingerprint: z.string().min(16),
  disabled: z.boolean().optional(),
});

export type MetaToolCreateInput = z.infer<typeof MetaToolCreateInputSchema>;
export type MetaToolDefinition = z.infer<typeof MetaToolDefinitionSchema>;
export type MetaToolScope = MetaToolDefinition['scope'];

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintMetaTool(input: Pick<MetaToolCreateInput, 'name' | 'description' | 'parameters' | 'handler'>): string {
  return createHash('sha256')
    .update(canonicalize({
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      handler: input.handler,
    }))
    .digest('hex');
}

export function normalizeMetaToolDefinition(candidate: unknown): MetaToolDefinition | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  const source = value.source === 'user' ? 'user' : 'agent';
  const scope = value.scope === 'project' ? 'project' : 'user';
  const definition = {
    ...value,
    schemaVersion: value.schemaVersion ?? META_TOOL_SCHEMA_VERSION,
    source,
    scope,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
  };

  const parsedCreateInput = MetaToolCreateInputSchema.safeParse(definition);
  if (!parsedCreateInput.success) {
    return null;
  }

  const parsed = MetaToolDefinitionSchema.safeParse({
    ...definition,
    fingerprint: typeof value.fingerprint === 'string'
      ? value.fingerprint
      : fingerprintMetaTool(parsedCreateInput.data),
  });

  return parsed.success ? parsed.data : null;
}
