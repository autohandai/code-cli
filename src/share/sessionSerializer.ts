/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session Serializer
 * Converts session data to ShareSessionPayload format
 */

import os from 'node:os';
import type { Session } from '../session/SessionManager.js';
import type { SessionMessage } from '../session/types.js';
import type {
  ShareSessionPayload,
  ShareSessionMetadata,
  ShareUsageStats,
  ShareVisibility,
  ShareClientInfo,
  ToolUsageSummary,
  GitDiffSummary,
} from './types.js';
import { estimateCost } from './costEstimator.js';
import packageJson from '../../package.json' with { type: 'json' };

// ============ Types ============

export interface SerializeOptions {
  /** Current model being used */
  model: string;
  /** Provider name */
  provider?: string;
  /** Total tokens used (if available from context) */
  totalTokens?: number;
  /** Visibility setting */
  visibility: ShareVisibility;
  /** Device ID for anonymous tracking */
  deviceId: string;
  /** Git diff content (if available) */
  gitDiff?: string;
  /** Authenticated user ID (if logged in) */
  userId?: string;
}

// ============ Tool Usage Extraction ============

/**
 * Extract tool usage statistics from messages
 */
function extractToolUsage(messages: SessionMessage[]): ToolUsageSummary[] {
  const toolCounts = new Map<string, { total: number; success: number }>();

  for (const message of messages) {
    // Count tool calls from assistant messages
    if (message.role === 'assistant' && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        const toolName = toolCall.function?.name || toolCall.name || 'unknown';
        const current = toolCounts.get(toolName) || { total: 0, success: 0 };
        current.total++;
        toolCounts.set(toolName, current);
      }
    }

    // Count tool responses (successful if no error)
    if (message.role === 'tool' && message.name) {
      const current = toolCounts.get(message.name);
      if (current) {
        // Simple heuristic: if content doesn't contain "error" or "failed", it's success
        const isError =
          message.content.toLowerCase().includes('error') ||
          message.content.toLowerCase().includes('failed');
        if (!isError) {
          current.success++;
        }
      }
    }
  }

  // Convert to array
  const result: ToolUsageSummary[] = [];
  for (const [name, counts] of toolCounts) {
    result.push({
      name,
      count: counts.total,
      successRate: counts.total > 0 ? counts.success / counts.total : undefined,
    });
  }

  // Sort by count (descending)
  return result.sort((a, b) => b.count - a.count);
}

// ============ Token Estimation ============

/**
 * Estimate tokens from messages when actual count is not available
 * Uses a rough approximation of 4 characters per token
 */
function estimateTokensFromMessages(messages: SessionMessage[]): {
  total: number;
  input: number;
  output: number;
} {
  let input = 0;
  let output = 0;

  for (const message of messages) {
    const chars = message.content.length;
    const tokens = Math.ceil(chars / 4);

    if (message.role === 'user' || message.role === 'system') {
      input += tokens;
    } else {
      output += tokens;
    }
  }

  return {
    total: input + output,
    input,
    output,
  };
}

// ============ Git Diff Parsing ============

/**
 * Parse git diff content into summary
 */
function parseGitDiff(diffContent: string): GitDiffSummary | undefined {
  if (!diffContent || diffContent.trim().length === 0) {
    return undefined;
  }

  const lines = diffContent.split('\n');
  const filesChanged = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of lines) {
    // Match file paths from diff headers
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        filesChanged.add(match[2]);
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      linesAdded++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      linesRemoved++;
    }
  }

  if (filesChanged.size === 0 && linesAdded === 0 && linesRemoved === 0) {
    return undefined;
  }

  return {
    filesChanged: Array.from(filesChanged),
    linesAdded,
    linesRemoved,
    diffContent,
  };
}

// ============ Duration Calculation ============

/**
 * Calculate session duration in seconds
 */
function calculateDuration(startedAt: string, endedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.max(0, Math.floor((end - start) / 1000));
}

// ============ Main Serializer ============

/**
 * Serialize a session into the share payload format
 */
export function serializeSession(
  session: Session,
  options: SerializeOptions
): ShareSessionPayload {
  const messages = session.getMessages();
  const { metadata } = session;

  // Calculate timestamps
  const endedAt = metadata.closedAt || new Date().toISOString();
  const durationSeconds = calculateDuration(metadata.createdAt, endedAt);

  // Build session metadata
  const sessionMetadata: ShareSessionMetadata = {
    sessionId: metadata.sessionId,
    projectName: metadata.projectName,
    model: options.model || metadata.model,
    provider: options.provider || 'openrouter',
    startedAt: metadata.createdAt,
    endedAt,
    durationSeconds,
    messageCount: messages.length,
    status: metadata.status,
    summary: metadata.summary,
  };

  // Calculate usage stats
  let usage: ShareUsageStats;
  if (options.totalTokens && options.totalTokens > 0) {
    // Use provided token count, estimate input/output split (assume 30/70)
    const inputTokens = Math.floor(options.totalTokens * 0.3);
    const outputTokens = options.totalTokens - inputTokens;
    usage = {
      totalTokens: options.totalTokens,
      inputTokens,
      outputTokens,
      estimatedCost: estimateCost(options.totalTokens),
    };
  } else {
    // Estimate from message content
    const estimated = estimateTokensFromMessages(messages);
    usage = {
      totalTokens: estimated.total,
      inputTokens: estimated.input,
      outputTokens: estimated.output,
      estimatedCost: estimateCost(estimated.total),
    };
  }

  // Extract tool usage
  const toolUsage = extractToolUsage(messages);

  // Parse git diff if provided
  const gitDiff = options.gitDiff
    ? parseGitDiff(options.gitDiff)
    : undefined;

  // Build client info
  const client: ShareClientInfo = {
    cliVersion: packageJson.version,
    platform: process.platform,
    deviceId: options.deviceId,
  };

  // Filter messages for sharing (remove sensitive _meta)
  const sharedMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    name: msg.name,
    toolCalls: msg.toolCalls,
    tool_call_id: msg.tool_call_id,
  }));

  return {
    metadata: sessionMetadata,
    usage,
    toolUsage,
    gitDiff,
    messages: sharedMessages,
    visibility: options.visibility,
    client,
    userId: options.userId,
  };
}
