/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { ActiveAgentRecord } from '../ActiveAgentRegistry.js';

export interface PeerFormatterOptions {
  /** Maximum number of paths to show per peer before truncating */
  maxPaths?: number;
  /** Maximum number of claims to show per peer before truncating */
  maxClaims?: number;
}

const DEFAULT_MAX_PATHS = 10;
const DEFAULT_MAX_CLAIMS = 10;

function formatHeadRef(headRef: { branch: string | null; sha: string } | undefined): string {
  if (!headRef) return 'unknown';
  const branch = headRef.branch ?? 'detached';
  const shortSha = headRef.sha.slice(0, 7);
  return `${branch} (${shortSha})`;
}

function formatList(items: string[] | undefined, max: number): string {
  if (!items || items.length === 0) return chalk.gray('none');
  const visible = items.slice(0, max);
  const more = items.length - visible.length;
  const lines = visible.map((item) => `  • ${item}`);
  if (more > 0) {
    lines.push(chalk.gray(`  … and ${more} more`));
  }
  return lines.join('\n');
}

function formatPeerCard(peer: ActiveAgentRecord, options: PeerFormatterOptions = {}): string {
  const { maxPaths = DEFAULT_MAX_PATHS, maxClaims = DEFAULT_MAX_CLAIMS } = options;
  const activity = peer.activity;

  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`Peer: ${peer.sessionId}`));
  lines.push(`  Model:      ${peer.model}`);
  lines.push(`  Provider:   ${peer.provider}`);
  lines.push(`  Mode:       ${peer.mode}`);
  lines.push(`  Status:     ${peer.status}`);
  lines.push(`  Context:    ${peer.contextPercent}%`);
  lines.push(`  Started:    ${peer.startedAt}`);

  if (activity) {
    lines.push(`  Phase:      ${activity.phase}`);
    if (activity.instruction) {
      lines.push(`  Instruction: ${activity.instruction}`);
    }
    if (activity.command) {
      lines.push(`  Command:    ${activity.command}`);
    }
    lines.push(`  Head:       ${formatHeadRef(activity.headRef)}`);
    lines.push(`  Paths written:`);
    lines.push(formatList(activity.pathsWritten, maxPaths));
    if (activity.claims && activity.claims.length > 0) {
      lines.push(`  Claims:`);
      lines.push(formatList(activity.claims, maxClaims));
    }
  } else {
    lines.push(chalk.gray('  (no activity data)'));
  }

  return lines.join('\n');
}

export function formatPeerCards(
  peers: ActiveAgentRecord[],
  options: PeerFormatterOptions = {},
): string {
  if (peers.length === 0) {
    return chalk.yellow('No active peers in this workspace.');
  }

  const cards = peers.map((peer) => formatPeerCard(peer, options));
  return cards.join('\n\n');
}
