/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cost Estimator
 * Simplified token cost estimation for session sharing
 */

import type { ShareUsageStats } from './types.js';

// ============ Constants ============

/**
 * Simplified cost rate per 1K tokens (USD)
 * This is an average across common models for estimation purposes
 */
const DEFAULT_COST_PER_1K_TOKENS = 0.003;

// ============ Cost Estimation ============

/**
 * Estimate the cost of a session based on total tokens
 * Uses a simplified fixed rate for all models
 *
 * @param totalTokens - Total tokens used in the session
 * @returns Estimated cost in USD
 */
export function estimateCost(totalTokens: number): number {
  if (totalTokens <= 0) return 0;

  const cost = (totalTokens / 1000) * DEFAULT_COST_PER_1K_TOKENS;

  // Round to 4 decimal places
  return Math.round(cost * 10000) / 10000;
}

/**
 * Create usage stats from token counts
 *
 * @param inputTokens - Input/prompt tokens
 * @param outputTokens - Output/completion tokens
 * @returns Usage stats with estimated cost
 */
export function createUsageStats(
  inputTokens: number,
  outputTokens: number
): ShareUsageStats {
  const totalTokens = inputTokens + outputTokens;

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    estimatedCost: estimateCost(totalTokens),
  };
}

/**
 * Format cost for display
 *
 * @param cost - Cost in USD
 * @returns Formatted cost string (e.g., "$0.0045" or "< $0.01")
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    if (cost === 0) return '$0.00';
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token count for display
 *
 * @param tokens - Number of tokens
 * @returns Formatted token string (e.g., "125K" or "1.2M")
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format duration in seconds to human readable string
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration (e.g., "5m 30s" or "1h 15m")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}
