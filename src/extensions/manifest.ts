/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { ExtensionManifestSchema, type ExtensionManifest } from './schema.js';
import type { ExtensionPackage } from './types.js';

export const EXTENSION_MANIFEST_FILE = 'autohand.extension.json';
export const EXTENSION_STATE_FILE = '.autohand-extension-state.json';
export const MAX_EXTENSION_MANIFEST_BYTES = 64 * 1024;
export const MAX_EXTENSION_CONTRIBUTION_BYTES = 256 * 1024;

function firstIssueMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'unknown validation error';
  }
  const location = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${location}${issue.message}`;
}

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  const parsed = ExtensionManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid extension manifest: ${firstIssueMessage(parsed.error)}`);
  }
  return parsed.data;
}

function findDuplicateJsonKey(text: string): string | undefined {
  let index = 0;

  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? '')) {
      index++;
    }
  };

  const parseString = (): string => {
    const start = index;
    index++;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index++;
        return JSON.parse(text.slice(start, index)) as string;
      }
      index++;
    }
    return '';
  };

  const parseValue = (): string | undefined => {
    skipWhitespace();
    if (text[index] === '{') {
      index++;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === '}') {
        index++;
        return undefined;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) {
          return key;
        }
        keys.add(key);
        skipWhitespace();
        index++;
        const nestedDuplicate = parseValue();
        if (nestedDuplicate) {
          return nestedDuplicate;
        }
        skipWhitespace();
        if (text[index] === '}') {
          index++;
          return undefined;
        }
        index++;
      }
      return undefined;
    }
    if (text[index] === '[') {
      index++;
      skipWhitespace();
      if (text[index] === ']') {
        index++;
        return undefined;
      }
      while (index < text.length) {
        const nestedDuplicate = parseValue();
        if (nestedDuplicate) {
          return nestedDuplicate;
        }
        skipWhitespace();
        if (text[index] === ']') {
          index++;
          return undefined;
        }
        index++;
      }
      return undefined;
    }
    if (text[index] === '"') {
      parseString();
      return undefined;
    }
    while (index < text.length && text[index] !== ',' && text[index] !== ']' && text[index] !== '}') {
      index++;
    }
    return undefined;
  };

  skipWhitespace();
  return parseValue();
}

export function parseExtensionJson(text: string, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON: ${reason}`);
  }
  const duplicateKey = findDuplicateJsonKey(text);
  if (duplicateKey) {
    throw new Error(`Invalid ${label} JSON: duplicate JSON key "${duplicateKey}"`);
  }
  return value;
}

async function readBoundedUtf8File(filePath: string, maximumBytes: number, label: string): Promise<string> {
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`${label} is not a regular file: ${filePath}`);
  }
  if (stat.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit: ${filePath}`);
  }
  const content = await fs.readFile(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new Error(`${label} is not valid UTF-8: ${filePath}`);
  }
}

export async function readExtensionContributionText(filePath: string): Promise<string> {
  return readBoundedUtf8File(
    filePath,
    MAX_EXTENSION_CONTRIBUTION_BYTES,
    'Extension contribution',
  );
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveExtensionContributionPath(
  packageRoot: string,
  declaredPath: string,
): Promise<string> {
  const root = await fs.realpath(packageRoot);
  const targetPath = path.resolve(root, ...declaredPath.split('/'));
  if (!isContainedPath(root, targetPath)) {
    throw new Error(`Contribution path is outside the extension root: ${declaredPath}`);
  }

  const targetStat = await fs.lstat(targetPath).catch(() => null);
  if (!targetStat) {
    throw new Error(`Contribution file does not exist: ${declaredPath}`);
  }
  if (targetStat.isSymbolicLink()) {
    throw new Error(`Contribution file may not be a symlink: ${declaredPath}`);
  }
  if (!targetStat.isFile()) {
    throw new Error(`Contribution path is not a regular file: ${declaredPath}`);
  }
  if (targetStat.size > MAX_EXTENSION_CONTRIBUTION_BYTES) {
    throw new Error(`Contribution file exceeds the ${MAX_EXTENSION_CONTRIBUTION_BYTES}-byte limit: ${declaredPath}`);
  }

  const realTarget = await fs.realpath(targetPath);
  if (!isContainedPath(root, realTarget)) {
    throw new Error(`Contribution path resolves outside the extension root: ${declaredPath}`);
  }
  return realTarget;
}

export async function readExtensionPackage(packageRoot: string): Promise<ExtensionPackage> {
  const root = await fs.realpath(packageRoot).catch(() => null);
  if (!root) {
    throw new Error(`Extension package does not exist: ${packageRoot}`);
  }
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Extension package root is not a directory: ${packageRoot}`);
  }

  const manifestPath = path.join(root, EXTENSION_MANIFEST_FILE);
  const manifestText = await readBoundedUtf8File(
    manifestPath,
    MAX_EXTENSION_MANIFEST_BYTES,
    'Extension manifest',
  );

  const manifestInput = parseExtensionJson(manifestText, 'extension manifest');
  const manifest = parseExtensionManifest(manifestInput);

  const tools = await Promise.all(
    (manifest.contributes.tools ?? []).map((declaredPath) =>
      resolveExtensionContributionPath(root, declaredPath)),
  );
  const agents = await Promise.all(
    (manifest.contributes.agents ?? []).map((declaredPath) =>
      resolveExtensionContributionPath(root, declaredPath)),
  );
  const skills = await Promise.all(
    (manifest.contributes.skills ?? []).map((declaredPath) =>
      resolveExtensionContributionPath(root, declaredPath)),
  );
  const runtime = await Promise.all(
    (manifest.contributes.runtime ?? []).map((declaredPath) =>
      resolveExtensionContributionPath(root, declaredPath)),
  );

  return {
    root,
    manifestPath,
    manifest,
    contributionFiles: { tools, agents, skills, runtime },
  };
}
