/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import {
  ActiveAgentRegistry,
  type ActiveAgentRecord,
} from '../ActiveAgentRegistry.js';
import {
  normalizePeerPath,
  warnForClaimConflict,
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
  type AwarenessTier,
  type PeerWarning,
} from './PeerWarnings.js';
import { readRepoHead, type RepoHead } from './RepoStateReader.js';

const MAX_PUBLISHED_PATHS = 20;

export interface PeerAwarenessManagerOptions {
  workspaceRoot: string;
  sessionId: string;
  tier: AwarenessTier;
  registry?: ActiveAgentRegistry;
  readHead?: (workspaceRoot: string) => Promise<RepoHead | null>;
}

export interface PeerRefresh {
  joined: ActiveAgentRecord[];
  left: ActiveAgentRecord[];
  warnings: PeerWarning[];
}

export class PeerAwarenessManager {
  private readonly registry: ActiveAgentRegistry;
  private readonly readHead: (workspaceRoot: string) => Promise<RepoHead | null>;
  private readonly workspaceRoot: string;
  private readonly tier: AwarenessTier;
  private sessionId: string;
  private peers: ActiveAgentRecord[] = [];
  private baseline: RepoHead | null = null;
  private readonly readCache = new Map<string, number>();
  private readonly pathsWritten: string[] = [];
  private readonly claims: string[] = [];
  private refreshPromise: Promise<PeerRefresh> | null = null;

  constructor(options: PeerAwarenessManagerOptions) {
    this.registry = options.registry ?? new ActiveAgentRegistry();
    this.readHead = options.readHead ?? readRepoHead;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.sessionId = options.sessionId;
    this.tier = options.tier;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getPeers(): ActiveAgentRecord[] {
    return [...this.peers];
  }

  getRepoBaseline(): RepoHead | null {
    return this.baseline ? { ...this.baseline } : null;
  }

  getPathsWritten(): string[] {
    return [...this.pathsWritten];
  }

  getClaims(): string[] {
    return this.tier === 'coordinate' ? [...this.claims] : [];
  }

  recordRead(relativePath: string, mtimeMs: number): void {
    if (!Number.isFinite(mtimeMs)) {
      return;
    }
    this.readCache.set(normalizePeerPath(relativePath), mtimeMs);
  }

  recordWrite(relativePath: string): void {
    const normalized = normalizePeerPath(relativePath);
    addNewestBounded(this.pathsWritten, normalized);
    this.claim(normalized);
  }

  claim(relativePath: string): void {
    if (this.tier === 'coordinate') {
      addNewestBounded(this.claims, normalizePeerPath(relativePath));
    }
  }

  async adoptRepoBaseline(): Promise<void> {
    this.baseline = await this.readHead(this.workspaceRoot);
  }

  refresh(): Promise<PeerRefresh> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  warnForWrite(relativePath: string, currentMtimeMs?: number): PeerWarning[] {
    const normalized = normalizePeerPath(relativePath);
    this.claim(normalized);
    const warnings = [
      ...warnForFileWrite(this.tier, normalized, this.peers),
      ...warnForClaimConflict(this.tier, normalized, this.peers),
    ];
    const readMtime = this.readCache.get(normalized);
    if (
      this.tier !== 'passive'
      && readMtime !== undefined
      && currentMtimeMs !== undefined
      && currentMtimeMs > readMtime
    ) {
      warnings.push({
        kind: 'file-collision',
        message: `${normalized} changed on disk after this session read it. Re-read it before overwriting.`,
      });
    }
    return warnings;
  }

  warnForCommand(command: string): PeerWarning[] {
    return warnForGitMutation(this.tier, command, this.peers);
  }

  private async performRefresh(): Promise<PeerRefresh> {
    const all = await this.registry.listActive();
    const next = all.filter((record) =>
      record.sessionId !== this.sessionId
      && path.resolve(record.workspaceRoot) === this.workspaceRoot);
    const previousIds = new Set(this.peers.map((peer) => peer.sessionId));
    const nextIds = new Set(next.map((peer) => peer.sessionId));
    const joined = next.filter((peer) => !previousIds.has(peer.sessionId));
    const left = this.peers.filter((peer) => !nextIds.has(peer.sessionId));
    this.peers = next;

    const current = await this.readHead(this.workspaceRoot);
    const warnings = warnForRepoDrift(this.tier, this.baseline, current, next);
    this.baseline = current;
    return { joined, left, warnings };
  }
}

function addNewestBounded(values: string[], value: string): void {
  if (!value) {
    return;
  }
  const existing = values.indexOf(value);
  if (existing >= 0) {
    values.splice(existing, 1);
  }
  values.unshift(value);
  if (values.length > MAX_PUBLISHED_PATHS) {
    values.length = MAX_PUBLISHED_PATHS;
  }
}
