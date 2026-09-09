import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { PeerError, type PeerScope } from './PeerProtocol.js';

export interface PeerScopeIdentity {
  workspaceId: string;
  repositoryId?: string;
}

export async function resolvePeerScope(workspaceRoot: string): Promise<PeerScopeIdentity> {
  const workspaceId = await realpath(workspaceRoot);
  if (!(await stat(workspaceId)).isDirectory()) throw new PeerError('INVALID_PARAMS', 'Peer workspace must be a directory.');
  const commonDirectory = await new Promise<string | undefined>(resolve => {
    execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: workspaceId, encoding: 'utf8', timeout: 2_000, maxBuffer: 8_192, windowsHide: true,
    }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
  const repositoryId = commonDirectory ? await realpath(path.resolve(workspaceId, commonDirectory)).catch(() => undefined) : undefined;
  return { workspaceId, ...(repositoryId ? { repositoryId } : {}) };
}

export function peerScopeIncludes(scope: PeerScope, local: PeerScopeIdentity, remote: PeerScopeIdentity): boolean {
  if (scope === 'machine') return true;
  if (scope === 'workspace') return local.workspaceId === remote.workspaceId;
  return local.workspaceId === remote.workspaceId || Boolean(local.repositoryId && local.repositoryId === remote.repositoryId);
}

export function assertPeerScope(requested: PeerScope, allowed: PeerScope): void {
  const rank = { workspace: 0, repository: 1, machine: 2 };
  if (!(requested in rank) || rank[requested] > rank[allowed]) throw new PeerError('SCOPE_DENIED', `Peer access is limited to ${allowed} scope.`);
}

export function allowedPeerScopes(allowed: PeerScope): PeerScope[] {
  const scopes: PeerScope[] = ['workspace', 'repository', 'machine'];
  return scopes.slice(0, scopes.indexOf(allowed) + 1);
}

export function peerIdFor(instanceId: string, runId?: string): string {
  return `peer-${createHash('sha256').update(JSON.stringify([instanceId, runId ?? null])).digest('hex').slice(0, 32)}`;
}

export function safePeerLabel(value: string, maxLength = 80): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, maxLength);
}

export function defaultPeerAlias(project: string, suffix: string): string {
  const normalized = project.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const prefix = /^[a-z]/.test(normalized) ? normalized : `agent-${normalized || 'local'}`;
  return `${prefix}-${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
}
