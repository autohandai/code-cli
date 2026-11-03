import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SkillCatalogEntry } from '../../../src/skills/SkillRuntime.js';

const entrySchema = z.object({
  authority: z.string(), packageId: z.string(), name: z.string(), description: z.string(), scope: z.string(),
  enabled: z.boolean().optional(), compatible: z.boolean().optional(),
});
const corpusSchema = z.object({
  version: z.literal(1), scoredQualityExperiment: z.literal(false), entries: z.array(entrySchema),
  queries: z.array(z.object({ query: z.string(), expected: z.array(z.string()), language: z.string().optional(), support: z.string().optional() })),
});

export type AdaptiveSkillsCorpus = z.infer<typeof corpusSchema>;
export const ADAPTIVE_CATALOG_SIZES = [0, 14, 100, 1_000, 10_000] as const;
export const ADAPTIVE_AUTHORIZED_SCOPES: ReadonlySet<string> = new Set(['builtin', 'project', 'personal']);

export async function loadAdaptiveSkillsCorpus(): Promise<AdaptiveSkillsCorpus> {
  return corpusSchema.parse(JSON.parse(await readFile(path.join(import.meta.dirname, '../fixtures/adaptive-skills-corpus.json'), 'utf8')));
}

export function createAdaptiveCatalog(corpus: AdaptiveSkillsCorpus, size: number, root = '/unused-metadata-fixture'): SkillCatalogEntry[] {
  return Array.from({ length: size }, (_, index): SkillCatalogEntry => {
    const fixture = corpus.entries[index];
    if (fixture) {
      return { reference: { authority: fixture.authority, packageId: fixture.packageId }, name: fixture.name,
        description: fixture.description, scope: fixture.scope, source: fixture.authority, root,
        enabled: fixture.enabled ?? true, ...(fixture.compatible === undefined ? {} : { compatible: fixture.compatible }) };
    }
    return { reference: { authority: 'project', packageId: `catalog-filler-${index}` }, name: `catalog-filler-${index}`,
      description: `Neutral catalog filler entry ${index}`, scope: 'project', source: 'project', root, enabled: true };
  });
}
