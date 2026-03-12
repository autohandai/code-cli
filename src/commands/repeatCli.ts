/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * repeatCli — parsing and config for the --repeat CLI flag (non-interactive mode).
 *
 * Usage:
 *   autohand --repeat "<interval>" "<prompt>"
 *   autohand --repeat "every 5 minutes run tests"
 *   autohand --repeat "5m" "run tests" --max-runs 10 --expires "7d"
 */

import { parseInput, intervalToCron } from './repeat.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepeatFlagOptions {
  maxRuns?: number;
  expires?: string;
}

export interface RepeatFlagResult {
  interval: string;
  prompt: string;
  maxRuns?: number;
  expiresIn?: string;
  error?: string;
}

export interface RepeatRunConfig {
  intervalMs: number;
  prompt: string;
  maxRuns?: number;
  expiresInMs: number;
  cronExpression: string;
  humanReadable: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_INTERVAL_RE = /^\d+[smhd]$/;
const INTERVAL_ATTEMPT_RE = /^\d+[a-zA-Z]+$/;
const VALID_SHORTHAND_RE = /^\d+[smhd]$/;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// ─── parseRepeatFlag ─────────────────────────────────────────────────────────

/**
 * Parse --repeat CLI flag arguments into a structured result.
 *
 * Supports:
 * - Two-arg: parseRepeatFlag('5m', 'run tests')
 * - Single natural language: parseRepeatFlag('every 5 minutes run tests')
 * - Options: { maxRuns, expires }
 */
export function parseRepeatFlag(
  firstArg: string,
  prompt?: string,
  options?: RepeatFlagOptions,
): RepeatFlagResult {
  const trimmedFirst = firstArg.trim();

  // Empty / whitespace input
  if (!trimmedFirst) {
    return { interval: '', prompt: '', error: 'No input provided. Usage: --repeat "<schedule>" "<prompt>"' };
  }

  let interval: string;
  let taskPrompt: string;

  if (VALID_INTERVAL_RE.test(trimmedFirst)) {
    // First arg is a valid interval like '5m', '2h'
    const trimmedPrompt = prompt?.trim() ?? '';
    if (!trimmedPrompt) {
      return { interval: trimmedFirst, prompt: '', error: 'No prompt provided. Usage: --repeat "<interval>" "<prompt>"' };
    }
    interval = trimmedFirst;
    taskPrompt = trimmedPrompt;
  } else if (INTERVAL_ATTEMPT_RE.test(trimmedFirst)) {
    // Looks like an interval attempt but has invalid unit (e.g. '5x')
    return { interval: '', prompt: '', error: `Invalid interval format: "${trimmedFirst}". Use <number><unit> where unit is s, m, h, or d.` };
  } else {
    // Not an interval — combine with prompt and use natural language parsing
    const combined = prompt ? `${trimmedFirst} ${prompt}`.trim() : trimmedFirst;
    const parsed = parseInput(combined);
    interval = parsed.interval;
    taskPrompt = parsed.prompt;

    if (!taskPrompt.trim()) {
      return { interval, prompt: '', error: 'Could not extract a prompt from the input.' };
    }
  }

  // Apply CLI options
  const maxRuns = options?.maxRuns !== undefined && options.maxRuns > 0
    ? options.maxRuns
    : undefined;

  const expiresIn = options?.expires && VALID_SHORTHAND_RE.test(options.expires)
    ? options.expires
    : undefined;

  return { interval, prompt: taskPrompt, maxRuns, expiresIn };
}

// ─── buildRepeatRunConfig ────────────────────────────────────────────────────

/**
 * Convert a parsed RepeatFlagResult into a runtime RepeatRunConfig.
 */
export function buildRepeatRunConfig(
  parsed: Pick<RepeatFlagResult, 'interval' | 'prompt' | 'maxRuns' | 'expiresIn'>,
): RepeatRunConfig {
  const cron = intervalToCron(parsed.interval);
  const expiresInMs = parsed.expiresIn ? shorthandToMs(parsed.expiresIn) : THREE_DAYS_MS;

  return {
    intervalMs: cron.intervalMs,
    prompt: parsed.prompt,
    maxRuns: parsed.maxRuns,
    expiresInMs,
    cronExpression: cron.cronExpression,
    humanReadable: cron.humanReadable,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shorthandToMs(shorthand: string): number {
  const match = shorthand.match(/^(\d+)([smhd])$/);
  if (!match) return THREE_DAYS_MS;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return THREE_DAYS_MS;
  }
}
