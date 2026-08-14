/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CATALOG_PROVENANCE_DIRECTORY = '.catalog';
export const CATALOG_PROVENANCE_FILE = 'provenance.json';

export interface CatalogProvenanceEntry {
  agentName: string;
  fileName: string;
  repository: string;
  catalogPath: string;
  contentHash: string;
  installedAt: string;
}

export interface CatalogProvenanceManifest {
  schemaVersion: 1;
  entries: Record<string, CatalogProvenanceEntry>;
}

export function hashCatalogContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function readCatalogProvenance(agentsDir: string): Promise<CatalogProvenanceManifest> {
  const manifestPath = path.join(agentsDir, CATALOG_PROVENANCE_DIRECTORY, CATALOG_PROVENANCE_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Partial<CatalogProvenanceManifest>;
    if (parsed.schemaVersion !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      throw new Error('unsupported catalog provenance schema');
    }
    return { schemaVersion: 1, entries: parsed.entries };
  } catch {
    return { schemaVersion: 1, entries: {} };
  }
}

export async function writeCatalogProvenanceEntry(
  agentsDir: string,
  entry: CatalogProvenanceEntry,
): Promise<void> {
  const directory = path.join(agentsDir, CATALOG_PROVENANCE_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  const manifestPath = path.join(directory, CATALOG_PROVENANCE_FILE);
  const manifest = await readCatalogProvenance(agentsDir);
  manifest.entries[entry.agentName] = entry;
  const temporaryPath = path.join(directory, `${CATALOG_PROVENANCE_FILE}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporaryPath, manifestPath);
}

export function isCatalogManagedContent(
  name: string,
  fileName: string,
  content: string,
  manifest: CatalogProvenanceManifest,
): boolean {
  const entry = manifest.entries[name];
  return entry?.fileName === fileName && entry.contentHash === hashCatalogContent(content);
}
