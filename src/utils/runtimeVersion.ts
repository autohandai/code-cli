/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import packageJson from '../../package.json' with { type: 'json' };

const STABLE_VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

interface RuntimeVersionOptions {
  manifestVersion?: string;
  versionSource?: string;
  readRepositoryTags?: () => readonly string[];
}

interface ParsedStableVersion {
  version: string;
  parts: readonly [number, number, number];
}

function parseStableVersionTag(tag: string): ParsedStableVersion | null {
  const match = STABLE_VERSION_TAG.exec(tag.trim());
  if (!match) {
    return null;
  }

  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }

  return {
    version: parts.join('.'),
    parts,
  };
}

function compareVersionParts(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function selectLatestStableRepositoryVersion(tags: readonly string[]): string | null {
  let latest: ParsedStableVersion | null = null;

  for (const tag of tags) {
    const candidate = parseStableVersionTag(tag);
    if (!candidate || (latest && compareVersionParts(candidate.parts, latest.parts) <= 0)) {
      continue;
    }
    latest = candidate;
  }

  return latest?.version ?? null;
}

function readReachableRepositoryTags(): string[] {
  const output = execFileSync(
    'git',
    ['tag', '--merged', 'HEAD', '--list'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  return output.split(/\r?\n/u).filter(Boolean);
}

export function resolveRuntimeVersion(options: RuntimeVersionOptions = {}): string {
  const manifestVersion = options.manifestVersion ?? packageJson.version;
  const versionSource = options.versionSource ?? process.env.AUTOHAND_VERSION_SOURCE;
  if (versionSource !== 'git') {
    return manifestVersion;
  }

  try {
    return selectLatestStableRepositoryVersion(
      (options.readRepositoryTags ?? readReachableRepositoryTags)(),
    ) ?? manifestVersion;
  } catch {
    return manifestVersion;
  }
}

export const runtimeVersion = resolveRuntimeVersion();
