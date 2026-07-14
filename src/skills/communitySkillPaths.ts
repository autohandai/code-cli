/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type {
  CommunitySkillsRegistry,
  GitHubCommunitySkill,
} from '../types.js';
import { isValidSkillName } from './types.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const URL_COMPONENT = /^[A-Za-z0-9._-]+$/;
const WINDOWS_AMBIGUOUS_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\..*)?$/i;

export interface GitHubSkillSourceLocation {
  owner: string;
  repo: string;
  branch: string;
  directory: string;
}

export function validateCommunitySkillIdentifier(
  value: string,
  label = 'community skill identifier'
): string {
  if (!isValidSkillName(value) || WINDOWS_RESERVED_SEGMENT.test(value)) {
    throw new Error(
      `Invalid ${label}: expected 1-64 lowercase alphanumeric or hyphen characters `
      + 'and a non-reserved filesystem name'
    );
  }

  return value;
}

export function validateCommunityRelativePath(
  value: string,
  label = 'community skill path'
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || CONTROL_CHARACTERS.test(value)
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`Invalid ${label}: expected an unchanged relative POSIX path`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid ${label}: dot and empty path segments are not allowed`);
  }
  if (segments.some((segment) => WINDOWS_AMBIGUOUS_CHARACTERS.test(segment))) {
    throw new Error(`Invalid ${label}: Windows-ambiguous characters are not allowed`);
  }
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' '))) {
    throw new Error(`Invalid ${label}: path segments may not end with a dot or space`);
  }
  if (segments.some((segment) => WINDOWS_RESERVED_SEGMENT.test(segment))) {
    throw new Error(`Invalid ${label}: Windows reserved names are not allowed`);
  }

  return value;
}

export function validateCommunitySkillFileMap(
  files: ReadonlyMap<string, string>,
  options: { requireSkillFile?: boolean } = {}
): Map<string, string> {
  if (!(files instanceof Map)) {
    throw new Error('Invalid community skill files: expected a file map');
  }

  const validated = new Map<string, string>();
  for (const [filePath, content] of files) {
    const safePath = validateCommunityRelativePath(filePath, 'community skill file path');
    if (typeof content !== 'string') {
      throw new Error(`Invalid community skill file content for ${safePath}`);
    }
    if (validated.has(safePath)) {
      throw new Error(`Invalid community skill files: duplicate path ${safePath}`);
    }
    validated.set(safePath, content);
  }

  if ((options.requireSkillFile ?? true) && !validated.has('SKILL.md')) {
    throw new Error('Invalid community skill files: missing required SKILL.md');
  }

  return validated;
}

export function validateCommunitySkillFiles(
  skill: GitHubCommunitySkill,
  files: ReadonlyMap<string, string>
): Map<string, string> {
  const validatedSkill = validateCommunitySkillMetadata(skill);
  const validatedFiles = validateCommunitySkillFileMap(files);
  const missingFiles = validatedSkill.files.filter((file) => !validatedFiles.has(file));
  if (missingFiles.length > 0) {
    throw new Error(
      `Invalid community skill files for ${validatedSkill.id}: missing ${missingFiles.join(', ')}`
    );
  }
  return validatedFiles;
}

export function validateCommunitySkillMetadata(skill: unknown): GitHubCommunitySkill {
  if (!skill || typeof skill !== 'object') {
    throw new Error('Invalid community skill metadata: expected an object');
  }

  const candidate = skill as Record<string, unknown>;
  const id = validateCommunitySkillIdentifier(
    typeof candidate.id === 'string' ? candidate.id : '',
    'community skill id'
  );
  const name = validateCommunitySkillDisplayName(candidate.name);

  if (typeof candidate.description !== 'string') {
    throw new Error(`Invalid community skill metadata for ${id}: missing description`);
  }
  if (typeof candidate.category !== 'string') {
    throw new Error(`Invalid community skill metadata for ${id}: missing category`);
  }

  const directory = validateCommunityRelativePath(
    typeof candidate.directory === 'string' ? candidate.directory : '',
    `community skill directory for ${id}`
  );
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
    throw new Error(`Invalid community skill metadata for ${id}: no files listed`);
  }

  const files: string[] = [];
  const seenFiles = new Set<string>();
  for (const value of candidate.files) {
    const file = validateCommunityRelativePath(
      typeof value === 'string' ? value : '',
      `community skill file for ${id}`
    );
    if (seenFiles.has(file)) {
      throw new Error(`Invalid community skill metadata for ${id}: duplicate file ${file}`);
    }
    seenFiles.add(file);
    files.push(file);
  }
  if (!seenFiles.has('SKILL.md')) {
    throw new Error(`Invalid community skill metadata for ${id}: missing required SKILL.md`);
  }

  if (candidate.source !== undefined) {
    validateGitHubRepository(String(candidate.source));
  }
  if (candidate.sourceUrl !== undefined) {
    parseGitHubSkillSourceUrl(String(candidate.sourceUrl));
  }

  return {
    ...(candidate as unknown as GitHubCommunitySkill),
    id,
    name,
    directory,
    files,
  };
}

export function validateCommunitySkillsRegistry(registry: unknown): CommunitySkillsRegistry {
  if (!registry || typeof registry !== 'object') {
    throw new Error('Invalid community skills registry: expected an object');
  }

  const candidate = registry as Record<string, unknown>;
  if (!Array.isArray(candidate.skills)) {
    throw new Error('Invalid community skills registry: missing skills array');
  }
  if (!Array.isArray(candidate.categories)) {
    throw new Error('Invalid community skills registry: missing categories array');
  }

  const skills = candidate.skills.map((skill) => validateCommunitySkillMetadata(skill));

  return {
    version: typeof candidate.version === 'string' ? candidate.version : '1.0.0',
    updatedAt: typeof candidate.updatedAt === 'string'
      ? candidate.updatedAt
      : new Date().toISOString(),
    skills,
    categories: candidate.categories as CommunitySkillsRegistry['categories'],
  };
}

export function resolveContainedCommunityPath(
  root: string,
  relativePath: string,
  label = 'community skill destination'
): string {
  const resolvedRoot = path.resolve(root);
  const destination = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, destination);

  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Invalid ${label}: destination is outside its trusted root`);
  }

  return destination;
}

export async function assertCommunityPathSymlinkSafe(
  root: string,
  destination: string,
  label = 'community skill destination'
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDestination = path.resolve(destination);
  const relative = path.relative(resolvedRoot, resolvedDestination);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Invalid ${label}: destination is outside its trusted root`);
  }

  const rootStat = await lstatIfPresent(resolvedRoot);
  if (rootStat?.isSymbolicLink()) {
    throw new Error(`Invalid ${label}: trusted root must not be a symlink`);
  }
  if (rootStat && !rootStat.isDirectory()) {
    throw new Error(`Invalid ${label}: trusted root is not a directory`);
  }

  const canonicalRoot = rootStat
    ? await fs.realpath(resolvedRoot)
    : await projectCanonicalPath(resolvedRoot);
  if (!relative) {
    return;
  }

  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstatIfPresent(current);
    if (!stat) {
      break;
    }

    const canonicalCurrent = await fs.realpath(current);
    if (!isPathWithin(canonicalRoot, canonicalCurrent)) {
      throw new Error(`Invalid ${label}: symlink escapes its trusted root`);
    }
  }
}

export function validateGitHubRepository(value: string): { owner: string; repo: string } {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value) || value.includes('\\')) {
    throw new Error('Invalid GitHub repository: expected owner/repo');
  }
  const parts = value.split('/');
  if (parts.length !== 2) {
    throw new Error('Invalid GitHub repository: expected owner/repo');
  }

  return {
    owner: validateGitHubUrlComponent(parts[0], 'GitHub owner'),
    repo: validateGitHubUrlComponent(parts[1], 'GitHub repository'),
  };
}

export function validateGitHubUrlComponent(value: string, label: string): string {
  if (
    !value
    || value === '.'
    || value === '..'
    || CONTROL_CHARACTERS.test(value)
    || !URL_COMPONENT.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function parseGitHubSkillSourceUrl(value: string): GitHubSkillSourceLocation {
  if (
    typeof value !== 'string'
    || CONTROL_CHARACTERS.test(value)
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.includes('%')
  ) {
    throw new Error('Invalid GitHub source URL');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid GitHub source URL');
  }

  if (
    url.protocol !== 'https:'
    || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Invalid GitHub source URL');
  }

  const parts = url.pathname.split('/');
  if (parts[0] !== '' || parts.some((part, index) => index > 0 && part === '')) {
    throw new Error('Invalid GitHub source URL path');
  }
  const [ownerValue, repoValue, marker, branchValue, ...sourcePath] = parts.slice(1);
  if ((marker !== 'tree' && marker !== 'blob') || sourcePath.length === 0) {
    throw new Error('Invalid GitHub source URL path');
  }

  const owner = validateGitHubUrlComponent(ownerValue ?? '', 'GitHub owner');
  const repo = validateGitHubUrlComponent(repoValue ?? '', 'GitHub repository');
  const branch = validateGitHubUrlComponent(branchValue ?? '', 'GitHub branch');
  const validatedPath = validateCommunityRelativePath(
    sourcePath.join('/'),
    'GitHub source path'
  );
  const directory = marker === 'blob'
    ? validatedPath.split('/').slice(0, -1).join('/')
    : validatedPath;
  if (!directory) {
    throw new Error('Invalid GitHub source URL path');
  }

  return { owner, repo, branch, directory };
}

export function encodeCommunityUrlPath(value: string): string {
  return value.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function validateCommunitySkillDisplayName(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || CONTROL_CHARACTERS.test(value)
    || value.includes('/')
    || value.includes('\\')
    || value === '.'
    || value === '..'
  ) {
    throw new Error('Invalid community skill display name');
  }
  return value;
}

async function lstatIfPresent(targetPath: string): Promise<Stats | null> {
  try {
    return await fs.lstat(targetPath) as Stats;
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function projectCanonicalPath(targetPath: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = targetPath;

  while (true) {
    const stat = await lstatIfPresent(current);
    if (stat) {
      if (stat.isSymbolicLink()) {
        throw new Error('Invalid community skill destination: ancestor must not be a symlink');
      }
      if (!stat.isDirectory()) {
        throw new Error('Invalid community skill destination: ancestor is not a directory');
      }
      const canonicalAncestor = await fs.realpath(current);
      return path.join(canonicalAncestor, ...missingSegments.reverse());
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Invalid community skill destination: no existing filesystem ancestor');
    }
    missingSegments.push(path.basename(current));
    current = parent;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
