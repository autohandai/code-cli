/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { formatCompactTokens } from '../agent/AgentFormatter.js';

/** `45s`, `2m 6s`, `1h 2m`: the two most significant units of a lane's running time. */
export function formatLaneElapsed(milliseconds: number): string {
  const totalSeconds = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

/** Total tokens the lane has used so far; empty until its run reports usage. */
export function formatLaneTokens(totalTokens: number | undefined): string {
  return totalTokens !== undefined && totalTokens > 0 ? `${formatCompactTokens(totalTokens)} tokens` : '';
}
