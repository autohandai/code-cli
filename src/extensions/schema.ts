/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const EXTENSION_SCHEMA_VERSION = 1;
export const EXTENSION_API_VERSION = 1;
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
export const EXTENSION_SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function isSafeContributionPath(value: string): boolean {
  if (
    value.length === 0
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.includes('\\')
    || value.includes('\0')
  ) {
    return false;
  }

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export const ExtensionContributionPathSchema = z
  .string()
  .max(240)
  .refine(isSafeContributionPath, 'contribution path must be a contained POSIX-style relative path');

const UniqueContributionPathsSchema = z
  .array(ExtensionContributionPathSchema)
  .min(1)
  .max(100)
  .refine((paths) => new Set(paths).size === paths.length, 'contribution paths must be unique');

export const ExtensionContributionsSchema = z
  .object({
    tools: UniqueContributionPathsSchema.optional(),
    agents: UniqueContributionPathsSchema.optional(),
    skills: UniqueContributionPathsSchema.optional(),
    runtime: UniqueContributionPathsSchema.optional(),
  })
  .strict()
  .refine(
    (contributes) => (
      (contributes.tools?.length ?? 0)
      + (contributes.agents?.length ?? 0)
      + (contributes.skills?.length ?? 0)
      + (contributes.runtime?.length ?? 0)
    ) > 0,
    'an extension must contribute at least one tool, agent, skill, or runtime entrypoint',
  );

export const ExtensionManifestSchema = z
  .object({
    $schema: z.string().url().max(500).optional(),
    schemaVersion: z.literal(EXTENSION_SCHEMA_VERSION),
    extensionApi: z.literal(EXTENSION_API_VERSION),
    id: z.string().trim().min(3).max(100).regex(EXTENSION_ID_PATTERN),
    name: z.string().trim().min(1).max(100),
    version: z.string().regex(EXTENSION_SEMVER_PATTERN),
    description: z.string().trim().min(1).max(500),
    license: z.string().trim().min(1).max(100).optional(),
    repository: z.string().url().max(500).optional(),
    contributes: ExtensionContributionsSchema,
  })
  .strict();

export const ExtensionStateSchema = z
  .object({
    disabled: z.boolean().optional(),
    linked: z.boolean().optional(),
    trusted: z.boolean().optional(),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;
export type ExtensionState = z.infer<typeof ExtensionStateSchema>;
