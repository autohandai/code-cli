/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { ImportSource } from '../import/types.js';
import {
  KEYBINDING_PROFILE_IDS,
  getKeybindingProfile,
  type KeybindingProfileId,
} from '../keybindings/profiles.js';

/** Another coding agent found on this machine, and what Autohand can take from it. */
export interface DetectedExternalAgent {
  id: string;
  label: string;
  /** Present when the agent's shortcuts can be followed. */
  profile?: KeybindingProfileId;
  /** Present when `/import` knows how to read the agent's data. */
  importSource?: ImportSource;
}

/** Profiles whose agent is also an import source, keyed by profile id. */
const PROFILE_IMPORT_SOURCES: Partial<Record<KeybindingProfileId, ImportSource>> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

/**
 * Probes the home directory for agents that have a keybinding profile or an
 * importer. Only directory existence is checked, so the call is cheap and the
 * result never depends on the agent's data.
 */
export async function detectExternalAgents(homeDir: string = os.homedir()): Promise<DetectedExternalAgent[]> {
  const { ImporterRegistry } = await import('../import/registry.js');
  const importers = new ImporterRegistry({}).getAll();
  const importerHomes = await Promise.all(
    importers.map(async (importer) => ({
      importer,
      installed: await fse.pathExists(importer.homePath.replace(/^~(?=\/|$)/, homeDir)),
    })),
  );
  const installedImporters = new Map(
    importerHomes.filter(({ installed }) => installed).map(({ importer }) => [importer.name, importer]),
  );

  const detected: DetectedExternalAgent[] = [];
  const claimedSources = new Set<ImportSource>();
  for (const profileId of KEYBINDING_PROFILE_IDS) {
    const profile = getKeybindingProfile(profileId);
    if (!profile.agentLabel) continue;
    const installed = await anyExists(profile.homeDirectories.map((directory) => path.join(homeDir, directory)));
    if (!installed) continue;
    const importSource = PROFILE_IMPORT_SOURCES[profileId];
    const importer = importSource ? installedImporters.get(importSource) : undefined;
    if (importer) claimedSources.add(importer.name);
    detected.push({
      id: profileId,
      label: profile.agentLabel,
      profile: profileId,
      ...(importer ? { importSource: importer.name } : {}),
    });
  }

  for (const importer of installedImporters.values()) {
    if (claimedSources.has(importer.name)) continue;
    detected.push({ id: importer.name, label: importer.displayName, importSource: importer.name });
  }
  return detected;
}

/** "Claude Code, Codex and Devin" for prompts and summaries. */
export function describeDetectedAgents(agents: readonly DetectedExternalAgent[]): string {
  const labels = agents.map((agent) => agent.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

async function anyExists(paths: string[]): Promise<boolean> {
  const results = await Promise.all(paths.map((candidate) => fse.pathExists(candidate)));
  return results.some(Boolean);
}
