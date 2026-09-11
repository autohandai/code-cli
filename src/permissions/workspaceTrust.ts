/**
 * Workspace trust for repository-supplied code.
 *
 * Hooks and MCP servers declared in `<workspace>/.autohand/` run commands as
 * soon as a session starts. A cloned repository can ship those files, so they
 * only apply after the user trusts the workspace for their exact content. Any
 * change to the declared hooks or servers produces a new fingerprint and asks
 * again.
 *
 * @license Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_FILES } from '../constants.js';
import type { HookDefinition, McpServerConfigEntry } from '../types.js';
import { atomicWriteFile, withFileLock } from '../utils/atomicFile.js';

const STORE_VERSION = 1;

/** Executable entries a workspace contributes through its project files. */
export interface WorkspaceTrustEntries {
  hooks: HookDefinition[];
  mcpServers: McpServerConfigEntry[];
}

interface TrustedWorkspaceRecord {
  fingerprint: string;
  trustedAt: string;
}

interface WorkspaceTrustStore {
  version: number;
  workspaces: Record<string, TrustedWorkspaceRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** JSON with sorted object keys and undefined fields dropped, for stable comparison and hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(
      Object.keys(entry)
        .sort()
        .filter((field) => entry[field] !== undefined)
        .map((field) => [field, entry[field]]),
    );
  }) ?? 'undefined';
}

export function computeWorkspaceTrustFingerprint(entries: WorkspaceTrustEntries): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJson({ hooks: entries.hooks, mcpServers: entries.mcpServers }))
    .digest('hex');
}

/** Resolve symlinks so an alias of a workspace shares its trust record. */
async function workspaceKey(workspaceRoot: string): Promise<string> {
  const resolved = path.resolve(workspaceRoot);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function readStore(storePath: string): Promise<WorkspaceTrustStore> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(storePath, 'utf8'));
    if (isRecord(parsed) && isRecord(parsed.workspaces)) {
      const workspaces: Record<string, TrustedWorkspaceRecord> = {};
      for (const [key, record] of Object.entries(parsed.workspaces)) {
        if (isRecord(record) && typeof record.fingerprint === 'string') {
          workspaces[key] = {
            fingerprint: record.fingerprint,
            trustedAt: typeof record.trustedAt === 'string' ? record.trustedAt : '',
          };
        }
      }
      return { version: STORE_VERSION, workspaces };
    }
  } catch {
    // A missing or unreadable store trusts nothing.
  }
  return { version: STORE_VERSION, workspaces: {} };
}

export async function isWorkspaceTrusted(
  workspaceRoot: string,
  fingerprint: string,
  storePath: string = AUTOHAND_FILES.trustedWorkspaces,
): Promise<boolean> {
  const store = await readStore(storePath);
  return store.workspaces[await workspaceKey(workspaceRoot)]?.fingerprint === fingerprint;
}

export async function trustWorkspace(
  workspaceRoot: string,
  fingerprint: string,
  storePath: string = AUTOHAND_FILES.trustedWorkspaces,
): Promise<void> {
  const key = await workspaceKey(workspaceRoot);
  await fs.ensureDir(path.dirname(storePath));
  await withFileLock(`${storePath}.lock`, async () => {
    const store = await readStore(storePath);
    store.workspaces[key] = { fingerprint, trustedAt: new Date().toISOString() };
    await atomicWriteFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
  });
}
