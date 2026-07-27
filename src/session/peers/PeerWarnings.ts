/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../../types.js';
import type { ActiveAgentRecord } from '../ActiveAgentRegistry.js';
import type { RepoHead } from './RepoStateReader.js';

export type AwarenessTier = 'passive' | 'warn' | 'coordinate';

export interface PeerWarning {
  kind: 'git-mutation' | 'file-collision' | 'repo-drift' | 'claim-conflict';
  message: string;
}

const AWARENESS_TIERS = new Set<AwarenessTier>(['passive', 'warn', 'coordinate']);
const GIT_MUTATION_SUBCOMMANDS = new Set([
  'commit',
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'push',
  'cherry-pick',
]);
const GIT_OPTIONS_WITH_VALUES = new Set([
  '-c',
  '-C',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
]);

export function resolveAwarenessTier(config: LoadedConfig): AwarenessTier {
  const configured = config.sessions?.awareness;
  return configured && AWARENESS_TIERS.has(configured) ? configured : 'warn';
}

export function isGitMutationCommand(command: string): boolean {
  return command
    .split(/&&|\|\||[;\n]/u)
    .some((segment) => isGitMutationSegment(segment.trim()));
}

function isGitMutationSegment(segment: string): boolean {
  if (!segment) {
    return false;
  }
  const tokens = segment.split(/\s+/u);
  let index = 0;
  while (index < tokens.length && isEnvironmentAssignment(tokens[index]!)) {
    index += 1;
  }
  const executable = tokens[index];
  if (!executable || !/(?:^|[/\\])git$/iu.test(executable)) {
    return false;
  }
  index += 1;

  while (index < tokens.length) {
    const token = tokens[index]!;
    const optionName = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (!token.startsWith('-')) {
      return GIT_MUTATION_SUBCOMMANDS.has(token.toLowerCase());
    }
    if (GIT_OPTIONS_WITH_VALUES.has(optionName) && !token.includes('=')) {
      index += 1;
    }
    index += 1;
  }
  return false;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token);
}

function warningsEnabled(tier: AwarenessTier): boolean {
  return tier === 'warn' || tier === 'coordinate';
}

function describePeers(peers: ActiveAgentRecord[]): string {
  return peers.length === 1 ? '1 other session' : `${peers.length} other sessions`;
}

function describePeerActivity(peers: ActiveAgentRecord[]): string {
  return peers
    .slice(0, 3)
    .map((peer) => {
      const id = peer.sessionId.slice(0, 8);
      const phase = peer.activity?.phase ?? peer.status;
      return `${id}: ${phase.replace(/_/gu, ' ')}`;
    })
    .join(', ');
}

export function normalizePeerPath(value: string): string {
  return value
    .replace(/\\/gu, '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+/gu, '/');
}

export function warnForGitMutation(
  tier: AwarenessTier,
  command: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier) || peers.length === 0 || !isGitMutationCommand(command)) {
    return [];
  }
  return [{
    kind: 'git-mutation',
    message: `${describePeers(peers)} active in this project (${describePeerActivity(peers)}). Check their work before changing shared git state.`,
  }];
}

export function warnForFileWrite(
  tier: AwarenessTier,
  relativePath: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier)) {
    return [];
  }
  const normalized = normalizePeerPath(relativePath);
  const colliding = peers.filter((peer) =>
    peer.activity?.pathsWritten.some((candidate) => normalizePeerPath(candidate) === normalized));
  if (colliding.length === 0) {
    return [];
  }
  return [{
    kind: 'file-collision',
    message: `${describePeers(colliding)} also wrote ${normalized} recently (${describePeerActivity(colliding)}).`,
  }];
}

export function warnForRepoDrift(
  tier: AwarenessTier,
  previous: RepoHead | null,
  current: RepoHead | null,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier) || !previous || !current || previous.sha === current.sha) {
    return [];
  }
  const branch = current.branch ?? 'HEAD';
  const peerContext = peers.length > 0 ? ` while ${describePeers(peers)} are active` : '';
  return [{
    kind: 'repo-drift',
    message: `${branch} moved to ${current.sha.slice(0, 9)} outside this session${peerContext}. Refresh git status before continuing.`,
  }];
}

export function warnForClaimConflict(
  tier: AwarenessTier,
  relativePath: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (tier !== 'coordinate') {
    return [];
  }
  const normalized = normalizePeerPath(relativePath);
  const holders = peers.filter((peer) =>
    peer.activity?.claims?.some((candidate) => normalizePeerPath(candidate) === normalized));
  if (holders.length === 0) {
    return [];
  }
  return [{
    kind: 'claim-conflict',
    message: `${normalized} is claimed by ${describePeers(holders)} (${describePeerActivity(holders)}). Confirm before overwriting it.`,
  }];
}
