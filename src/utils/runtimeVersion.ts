/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import packageJson from '../../package.json' with { type: 'json' };

const STABLE_VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const BUILD_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const GIT_COMMIT = /^[0-9a-f]{7,40}$/iu;
export const GIT_VERSION_LOOKUP_TIMEOUT_MS = 1_000;

interface RuntimeVersionOptions {
  manifestVersion?: string;
  buildVersion?: string;
  versionSource?: string;
  readRepositoryTags?: () => readonly string[];
  readRepositoryCommit?: () => string;
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

export function deriveNextAlphaVersion(stableVersion: string, commit: string): string | null {
  const parsed = parseStableVersionTag(`v${stableVersion}`);
  const normalizedCommit = commit.trim().toLowerCase();
  if (!parsed || !GIT_COMMIT.test(normalizedCommit)) {
    return null;
  }

  const [major, minor, patch] = parsed.parts;
  return `${major}.${minor}.${patch + 1}-alpha.${normalizedCommit.slice(0, 7)}`;
}

function readReachableRepositoryTags(): string[] {
  const output = execFileSync(
    'git',
    ['tag', '--merged', 'HEAD', '--list'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_VERSION_LOOKUP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );

  return output.split(/\r?\n/u).filter(Boolean);
}

function readRepositoryCommit(): string {
  return execFileSync(
    'git',
    ['rev-parse', '--short=7', 'HEAD'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_VERSION_LOOKUP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  ).trim();
}

export function resolveRuntimeVersion(options: RuntimeVersionOptions = {}): string {
  const manifestVersion = options.manifestVersion ?? packageJson.version;
  const buildVersion = options.buildVersion ?? process.env.AUTOHAND_BUILD_VERSION;
  if (buildVersion && BUILD_VERSION.test(buildVersion.trim())) {
    return buildVersion.trim();
  }

  const versionSource = options.versionSource ?? process.env.AUTOHAND_VERSION_SOURCE;
  if (versionSource !== 'git') {
    return manifestVersion;
  }

  try {
    const stableVersion = selectLatestStableRepositoryVersion(
      (options.readRepositoryTags ?? readReachableRepositoryTags)(),
    );
    if (!stableVersion) {
      return manifestVersion;
    }
    return deriveNextAlphaVersion(
      stableVersion,
      (options.readRepositoryCommit ?? readRepositoryCommit)(),
    ) ?? manifestVersion;
  } catch {
    return manifestVersion;
  }
}

export const runtimeVersion = resolveRuntimeVersion();
