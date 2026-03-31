/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /repeat — schedule a recurring prompt at a fixed interval.
 *
 * Usage:
 *   /repeat [interval] <prompt>
 *   /repeat cancel <id>
 *   /repeat list
 */
import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { RepeatManager } from '../core/RepeatManager.js';
import type { LLMProvider } from '../providers/LLMProvider.js';

export const metadata: SlashCommand = {
  command: '/repeat',
  description: 'Schedule a recurring prompt at a fixed interval',
  implemented: true,
  subcommands: [
    { name: 'list', description: 'Show all active recurring jobs' },
    { name: 'cancel', description: 'Cancel a recurring job by ID' },
    { name: 'help', description: 'Show usage and examples' },
  ],
};

export interface RepeatCommandContext {
  repeatManager?: RepeatManager;
  llm?: LLMProvider;
}

const DEFAULT_INTERVAL = '5m';

// ─── Parsing ────────────────────────────────────────────────────────────────

interface ParsedInput {
  interval: string;
  prompt: string;
  /** True when the interval was explicitly matched by a regex rule (not the default fallback) */
  explicit?: boolean;
  /** Maximum number of executions before auto-cancel. */
  maxRuns?: number;
  /** Custom expiry duration in shorthand (e.g. "7d", "2h"). */
  expiresIn?: string;
}

const LEADING_INTERVAL_RE = /^\d+[smhd]$/;
const LEADING_EVERY_RE = /^every\s+(\d+)?\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?)\s+/i;
const TRAILING_EVERY_RE = /\s+every\s+(\d+)?\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?)$/i;
const MIDDLE_EVERY_RE = /\s+every\s+(\d+)?\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?)\s+/i;
const UNIT_MAP: Record<string, string> = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
};

/**
 * Parse raw user input into { interval, prompt } following the priority rules:
 * 1. Leading token matching ^\d+[smhd]$
 * 2. Leading "every <N><unit>" clause (e.g. "every 2 minutes run tests")
 * 3. Trailing "every <N><unit>" clause (e.g. "run tests every 5m")
 * 4. Middle "every <N><unit>" clause (e.g. "tell a joke every 10s about life")
 * 5. Default interval with entire input as prompt
 */
export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();
  const parts = trimmed.split(/\s+/);

  // Rule 1: leading interval token (e.g. "5m run tests")
  if (parts.length >= 1 && LEADING_INTERVAL_RE.test(parts[0])) {
    return {
      interval: parts[0],
      prompt: parts.slice(1).join(' '),
      explicit: true,
    };
  }

  // Rule 2: leading "every [N] <unit>" (e.g. "every 2 minutes run tests", "every minute check logs")
  const leadingMatch = trimmed.match(LEADING_EVERY_RE);
  if (leadingMatch) {
    const n = leadingMatch[1] || '1';
    const rawUnit = leadingMatch[2].toLowerCase();
    const unit = UNIT_MAP[rawUnit];
    if (unit) {
      return {
        interval: `${n}${unit}`,
        prompt: trimmed.slice(leadingMatch[0].length).trim(),
        explicit: true,
      };
    }
  }

  // Rule 3: trailing "every [N] <unit>" (e.g. "run tests every 5m", "say hello every minute")
  const trailingMatch = trimmed.match(TRAILING_EVERY_RE);
  if (trailingMatch) {
    const n = trailingMatch[1] || '1';
    const rawUnit = trailingMatch[2].toLowerCase();
    const unit = UNIT_MAP[rawUnit];
    if (unit) {
      return {
        interval: `${n}${unit}`,
        prompt: trimmed.slice(0, trailingMatch.index!).trim(),
        explicit: true,
      };
    }
  }

  // Rule 4: middle "every [N] <unit>" (e.g. "tell a joke every 10s about life", "say hello every minute to me")
  const middleMatch = trimmed.match(MIDDLE_EVERY_RE);
  if (middleMatch) {
    const n = middleMatch[1] || '1';
    const rawUnit = middleMatch[2].toLowerCase();
    const unit = UNIT_MAP[rawUnit];
    if (unit) {
      const before = trimmed.slice(0, middleMatch.index!).trim();
      const after = trimmed.slice(middleMatch.index! + middleMatch[0].length).trim();
      const prompt = [before, after].filter(Boolean).join(' ');
      return {
        interval: `${n}${unit}`,
        prompt,
        explicit: true,
      };
    }
  }

  // Rule 5: default — no interval detected
  return {
    interval: DEFAULT_INTERVAL,
    prompt: trimmed,
    explicit: false,
  };
}

// ─── Interval → cron ────────────────────────────────────────────────────────

interface CronResult {
  cronExpression: string;
  intervalMs: number;
  humanReadable: string;
  roundedNote?: string;
}

/**
 * Convert a shorthand interval (e.g. "5m", "2h", "1d", "30s") to a cron expression.
 * Returns the cron expression, the interval in ms, a human-readable cadence,
 * and an optional note if the interval was rounded.
 */
export function intervalToCron(interval: string): CronResult {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`);
  }

  let n = parseInt(match[1], 10);
  const unit = match[2];

  // Seconds → round up to nearest minute (min 1m)
  if (unit === 's') {
    const minutes = Math.max(1, Math.ceil(n / 60));
    const roundedNote = `Rounded ${n}s up to ${minutes}m (cron minimum granularity is 1 minute).`;
    return intervalToCronMinutes(minutes, roundedNote);
  }

  if (unit === 'm') {
    return intervalToCronMinutes(n);
  }

  if (unit === 'h') {
    if (n <= 0) throw new Error('Hour interval must be >= 1');
    if (n > 23) {
      // Convert to days
      const days = Math.round(n / 24);
      const roundedNote = `Rounded ${n}h to ${days}d (${days * 24}h).`;
      return {
        cronExpression: `0 0 */${days} * *`,
        intervalMs: days * 24 * 60 * 60 * 1000,
        humanReadable: `every ${days} day${days > 1 ? 's' : ''} at midnight`,
        roundedNote,
      };
    }
    // Check if it divides 24 cleanly
    let roundedNote: string | undefined;
    if (24 % n !== 0) {
      const clean = nearestDivisor(n, 24);
      roundedNote = `${n}h doesn't divide 24 evenly; rounded to every ${clean}h.`;
      n = clean;
    }
    return {
      cronExpression: `0 */${n} * * *`,
      intervalMs: n * 60 * 60 * 1000,
      humanReadable: `every ${n} hour${n > 1 ? 's' : ''}`,
      roundedNote,
    };
  }

  // Days
  if (n <= 0) throw new Error('Day interval must be >= 1');
  return {
    cronExpression: `0 0 */${n} * *`,
    intervalMs: n * 24 * 60 * 60 * 1000,
    humanReadable: `every ${n} day${n > 1 ? 's' : ''} at midnight`,
  };
}

function intervalToCronMinutes(n: number, roundedNote?: string): CronResult {
  if (n <= 0) throw new Error('Minute interval must be >= 1');

  if (n < 60) {
    // Check if it divides 60 cleanly
    let note = roundedNote;
    if (60 % n !== 0) {
      const clean = nearestDivisor(n, 60);
      note = (note ? note + ' ' : '') + `${n}m doesn't divide 60 evenly; rounded to every ${clean}m.`;
      n = clean;
    }
    return {
      cronExpression: `*/${n} * * * *`,
      intervalMs: n * 60 * 1000,
      humanReadable: `every ${n} minute${n > 1 ? 's' : ''}`,
      roundedNote: note,
    };
  }

  // 60+ minutes → convert to hours
  let hours = Math.round(n / 60);
  if (hours <= 0) hours = 1;
  let note = roundedNote;
  if (24 % hours !== 0) {
    const clean = nearestDivisor(hours, 24);
    note = (note ? note + ' ' : '') + `${n}m rounds to ${hours}h which doesn't divide 24; using every ${clean}h.`;
    hours = clean;
  } else if (n !== hours * 60) {
    note = (note ? note + ' ' : '') + `Rounded ${n}m to ${hours}h.`;
  }
  return {
    cronExpression: `0 */${hours} * * *`,
    intervalMs: hours * 60 * 60 * 1000,
    humanReadable: `every ${hours} hour${hours > 1 ? 's' : ''}`,
    roundedNote: note,
  };
}

/**
 * Find the divisor of `max` closest to `n`.
 */
function nearestDivisor(n: number, max: number): number {
  let best = 1;
  for (let d = 1; d <= max; d++) {
    if (max % d === 0 && Math.abs(d - n) < Math.abs(best - n)) {
      best = d;
    }
  }
  return best;
}

// ─── Duration helpers ────────────────────────────────────────────────────────

/**
 * Convert shorthand duration (e.g. "7d", "2h") to milliseconds.
 */
export function shorthandToMs(shorthand: string): number {
  const match = shorthand.match(/^(\d+)([smhd])$/);
  if (!match) return 3 * 24 * 60 * 60 * 1000; // fallback 3 days
  const n = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 3 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Convert shorthand duration to human-readable string.
 */
export function shorthandToHuman(shorthand: string): string {
  const match = shorthand.match(/^(\d+)([smhd])$/);
  if (!match) return shorthand;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const names: Record<string, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
  const name = names[unit] ?? unit;
  return `${n} ${name}${n !== 1 ? 's' : ''}`;
}

// ─── LLM intent extraction ──────────────────────────────────────────────────

const REPEAT_SYSTEM_PROMPT = `# Goal
Extract a recurring schedule from natural language. Return the interval and the actionable task as JSON.

# Persona
You are a scheduling intent parser for a CLI coding agent. You receive raw user input and decompose it into exactly two parts: how often (interval) and what to do (prompt). You are precise, never hallucinate fields, and always return valid JSON.

# Action
Return ONLY a JSON object with these fields:
- "interval": (required) shorthand format <number><unit> where unit is s, m, h, or d (e.g. "5m", "2h", "1d")
- "prompt": (required) the actionable task, cleaned of all scheduling language and conversational filler
- "maxRuns": (optional, integer) if the user specifies a finite execution count, include it. Omit if unlimited.
- "expiresIn": (optional, shorthand like interval) if the user specifies a custom duration/deadline, include it. Omit to use the default 3-day expiry.

## Interval extraction rules (in priority order)

1. Explicit frequency → convert directly:
   "every 5 minutes" → "5m" | "every 2 hours" → "2h" | "every 30 seconds" → "30s" | "every 3 days" → "3d"

2. Named frequencies → map to interval:
   "every minute" → "1m" | "every hour" → "1h" | "every day" → "1d" | "every second" → "1s"
   "hourly" → "1h" | "daily" → "1d" | "every half hour" → "30m" | "every quarter hour" → "15m"

3. Multiplicative expressions → compute interval:
   "twice an hour" → "30m" | "three times an hour" → "20m" | "once an hour" → "1h"
   "twice a day" → "12h" | "three times a day" → "8h" | "once a day" → "1d"

4. Colloquial / vague frequencies → best-effort:
   "every couple of minutes" → "2m" | "every few minutes" → "5m" | "every other hour" → "2h"
   "continuously" / "nonstop" / "constantly" → "1m" | "periodically" / "frequently" / "regularly" → "5m"

5. Implied repetition words are scheduling intent — strip them from the prompt:
   "keep running tests" → interval "1m", prompt "run tests"
   "keep checking the build" → interval "1m", prompt "check the build"
   "repeatedly lint the codebase" → interval "5m", prompt "lint the codebase"

6. Unsupported time scales → clamp to "1d":
   "weekly" / "monthly" / "every week" / "every month" → "1d"

7. No frequency detected at all → use "5m" as default.

## Disambiguation: conflicting interval signals

When the input contains multiple time references that could be intervals, apply these rules:
1. The most specific/granular interval wins as the "interval" field.
2. The broader time reference becomes "expiresIn" context (if it specifies a duration).

Granularity order (most specific first): seconds → minutes → hours → days.

Examples:
- "every day run this command with intervals of 10 minutes per run" → interval: "10m", expiresIn: "1d"
  ("intervals of 10 minutes" is more specific than "every day")
- "check deploy every day for a week at 10 minute intervals" → interval: "10m", expiresIn: "7d"
- "run tests daily with 5 minute checks" → interval: "5m", expiresIn: "1d"
- "every hour check build every 2 minutes" → interval: "2m", expiresIn: "1h"

## Execution count extraction (maxRuns)

When the user specifies a finite number of executions, extract it as "maxRuns":
- "only 10 times" → maxRuns: 10
- "do this 5 times" → maxRuns: 5
- "repeat 3 times" → maxRuns: 3
- "just once" / "one time" → maxRuns: 1
- "twice" / "two times" → maxRuns: 2
- No count mentioned → omit maxRuns entirely

Strip the count language from the prompt (e.g. "only 10 times", "5 times", "twice").

## Custom expiry extraction (expiresIn)

When the user specifies a duration/deadline for how long the job should stay active, extract it as "expiresIn":
- "for the next week" / "for a week" → expiresIn: "7d"
- "for 2 days" → expiresIn: "2d"
- "for the next hour" → expiresIn: "1h"
- "until tomorrow" → expiresIn: "1d"
- "for 30 minutes" → expiresIn: "30m"
- No duration mentioned → omit expiresIn entirely (default: 3 days)

Strip the expiry language from the prompt.

## Prompt cleaning rules

1. Strip conversational filler: remove leading "can you", "could you", "please", "I want you to", "I need you to", "go ahead and", "make sure to", "try to".
2. Strip scheduling language: remove "every X minutes", "hourly", "daily", "continuously", "keep", "repeatedly", "nonstop", "on repeat", "periodically", etc.
3. Preserve slash commands and their arguments verbatim: "/deploy staging", "/babysit-prs", "/lint --fix".
4. Preserve technical content exactly: file paths, command flags, branch names, URLs.
5. Do NOT rephrase or summarize the task — keep the user's own words minus filler and scheduling.

## Disambiguation: "every" as quantifier vs frequency

"every" followed by a time expression (number + unit, or time noun) = frequency → extract it.
"every" followed by a non-time noun = quantifier (part of the task) → keep it in the prompt.

Frequency: "check deploy every 5 minutes", "run hourly", "every 2h run tests"
Quantifier: "check every PR", "review every file", "test every endpoint", "lint every module"

## Disambiguation: time words inside task names

If a time word (hourly, daily, etc.) is part of a compound noun or script name, it describes the TASK, not the frequency.
"run the hourly backup script" → interval "5m", prompt "run the hourly backup script"
"check the daily report" → interval "5m", prompt "check the daily report"
"execute the 5-minute health check" → interval "5m", prompt "execute the 5-minute health check"

# Examples

Input: "can you run tests every 5 minutes"
Output: {"interval":"5m","prompt":"run tests"}

Input: "please check the deploy hourly"
Output: {"interval":"1h","prompt":"check the deploy"}

Input: "navigate to my gh pr list and pick one item to work on every 2 minutes"
Output: {"interval":"2m","prompt":"navigate to my gh pr list and pick one item to work on"}

Input: "make a git commit with empty message to trigger ci cd hourly"
Output: {"interval":"1h","prompt":"make a git commit with empty message to trigger ci cd"}

Input: "check for new issues on github twice an hour"
Output: {"interval":"30m","prompt":"check for new issues on github"}

Input: "run the test suite"
Output: {"interval":"5m","prompt":"run the test suite"}

Input: "keep monitoring the logs"
Output: {"interval":"1m","prompt":"monitor the logs"}

Input: "check every PR for review comments"
Output: {"interval":"5m","prompt":"check every PR for review comments"}

Input: "I want you to continuously watch the build pipeline"
Output: {"interval":"1m","prompt":"watch the build pipeline"}

Input: "run the hourly backup script every 30m"
Output: {"interval":"30m","prompt":"run the hourly backup script"}

Input: "/deploy staging every 10m"
Output: {"interval":"10m","prompt":"/deploy staging"}

Input: "could you maybe check if the tests pass"
Output: {"interval":"5m","prompt":"check if the tests pass"}

Input: "check for git commits from origin every minute"
Output: {"interval":"1m","prompt":"check for git commits from origin"}

Input: "tell me a joke every 2 minutes only 10 times"
Output: {"interval":"2m","prompt":"tell me a joke","maxRuns":10}

Input: "check PRs every day for the next week"
Output: {"interval":"1d","prompt":"check PRs","expiresIn":"7d"}

Input: "run tests every 5m do this 3 times"
Output: {"interval":"5m","prompt":"run tests","maxRuns":3}

Input: "check build every hour only 5 times for 2 days"
Output: {"interval":"1h","prompt":"check build","maxRuns":5,"expiresIn":"2d"}

Input: "every day run echo hello world with intervals of 10 minutes per run"
Output: {"interval":"10m","prompt":"run echo hello world","expiresIn":"1d"}

Input: "every hour check build every 2 minutes"
Output: {"interval":"2m","prompt":"check build","expiresIn":"1h"}`;

/**
 * Use the LLM to extract interval + prompt from ambiguous natural language.
 * Falls back to the regex result on any error.
 */
async function llmParseInput(raw: string, llm: LLMProvider): Promise<ParsedInput> {
  try {
    const response = await llm.complete({
      messages: [
        { role: 'system', content: REPEAT_SYSTEM_PROMPT },
        { role: 'user', content: raw },
      ],
      maxTokens: 200,
      temperature: 0,
    });

    const text = response.content.trim();
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return parseInput(raw);

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const interval = typeof parsed.interval === 'string' ? parsed.interval : DEFAULT_INTERVAL;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';

    // Validate the interval format
    if (!/^\d+[smhd]$/.test(interval)) return parseInput(raw);

    // Extract optional maxRuns
    const maxRuns = typeof parsed.maxRuns === 'number' && Number.isInteger(parsed.maxRuns) && parsed.maxRuns > 0
      ? parsed.maxRuns
      : undefined;

    // Extract optional expiresIn
    const expiresIn = typeof parsed.expiresIn === 'string' && /^\d+[smhd]$/.test(parsed.expiresIn)
      ? parsed.expiresIn
      : undefined;

    return { interval, prompt, maxRuns, expiresIn };
  } catch {
    // On any LLM error, fall back to regex parsing
    return parseInput(raw);
  }
}

// ─── Command handler ─────────────────────────────────────────────────────────

export async function repeat(
  ctx: RepeatCommandContext,
  args: string[] = [],
): Promise<string | null> {
  if (!ctx.repeatManager) {
    return chalk.yellow('Repeat manager not available.');
  }

  const raw = args.join(' ').trim();

  // Subcommand: help
  if (args[0]?.toLowerCase() === 'help') {
    return showUsage();
  }

  // Subcommand: cancel
  if (args[0]?.toLowerCase() === 'cancel') {
    const id = args[1]?.trim();
    if (!id) {
      return chalk.yellow('Usage: /repeat cancel <job-id>');
    }
    const ok = ctx.repeatManager.cancel(id);
    return ok
      ? chalk.green(`Cancelled recurring job ${chalk.bold(id)}.`)
      : chalk.yellow(`No active job with ID ${chalk.bold(id)}.`);
  }

  // Subcommand: list
  if (args[0]?.toLowerCase() === 'list') {
    const jobs = ctx.repeatManager.list();
    if (jobs.length === 0) {
      return chalk.gray('No recurring jobs scheduled.');
    }
    const lines = [chalk.bold('Active recurring jobs:'), ''];
    for (const job of jobs) {
      const remaining = Math.max(0, job.expiresAt - Date.now());
      const hoursLeft = Math.round(remaining / (60 * 60 * 1000));
      lines.push(
        `  ${chalk.cyan(job.id)}  ${chalk.white(job.humanInterval)}  ${chalk.gray(job.cronExpression)}`,
        `    ${chalk.gray('prompt:')} ${job.prompt}`,
      );
      if (job.maxRuns !== undefined) {
        lines.push(`    ${chalk.gray(`runs: ${job.runCount}/${job.maxRuns}`)}`);
      }
      lines.push(
        `    ${chalk.gray(`expires in ~${hoursLeft}h`)}`,
        '',
      );
    }
    return lines.join('\n');
  }

  // Subcommand: help or no args
  if (!raw) {
    return showUsage();
  }

  // Typo detection: if the user typed a single word that looks like a
  // misspelled subcommand, suggest the correct one instead of scheduling.
  if (args.length === 1) {
    const SUBCOMMANDS = ['list', 'cancel', 'help'];
    const firstArg = args[0].toLowerCase();
    if (!SUBCOMMANDS.includes(firstArg)) {
      const closest = findClosestSubcommand(firstArg, SUBCOMMANDS);
      if (closest) {
        return chalk.yellow(`Unknown subcommand "${args[0]}". Did you mean ${chalk.bold(`/repeat ${closest}`)}?`) + '\n\n' + showUsage();
      }
    }
  }

  // LLM-first parsing: try LLM for best natural language understanding,
  // fall back to regex if LLM is unavailable or fails
  let interval: string;
  let prompt: string;
  let maxRuns: number | undefined;
  let expiresIn: string | undefined;

  if (ctx.llm) {
    console.log(chalk.gray('Parsing schedule...'));
    const llmResult = await llmParseInput(raw, ctx.llm);
    interval = llmResult.interval;
    prompt = llmResult.prompt;
    maxRuns = llmResult.maxRuns;
    expiresIn = llmResult.expiresIn;
  } else {
    const regexResult = parseInput(raw);
    interval = regexResult.interval;
    prompt = regexResult.prompt;
  }

  if (!prompt) {
    return showUsage();
  }

  // Convert interval to cron
  let cron: CronResult;
  try {
    cron = intervalToCron(interval);
  } catch (err) {
    return chalk.red(`Invalid interval "${interval}": ${(err as Error).message}`);
  }

  // Compute custom expiry duration
  const expiresInMs = expiresIn ? shorthandToMs(expiresIn) : undefined;
  const expiresInHuman = expiresIn ? shorthandToHuman(expiresIn) : undefined;

  // Schedule the job
  const job = ctx.repeatManager.schedule(prompt, cron.intervalMs, cron.cronExpression, cron.humanReadable, {
    maxRuns,
    expiresInMs,
  });

  // Confirmation message
  const lines = [
    chalk.green('Recurring job scheduled!'),
    '',
    `  ${chalk.gray('Job ID:')}      ${chalk.cyan(job.id)}`,
    `  ${chalk.gray('Prompt:')}      ${prompt}`,
    `  ${chalk.gray('Cadence:')}     ${cron.humanReadable}`,
    `  ${chalk.gray('Cron:')}        ${cron.cronExpression}`,
  ];

  if (maxRuns !== undefined) {
    lines.push(`  ${chalk.gray('Limit:')}       ${maxRuns} runs`);
  }

  if (cron.roundedNote) {
    lines.push(`  ${chalk.yellow('Note:')}        ${cron.roundedNote}`);
  }

  const expiryLabel = expiresInHuman ?? '3 days';
  lines.push(
    '',
    chalk.gray(`Recurring jobs auto-expire after ${expiryLabel}.`),
    chalk.gray(`Cancel sooner with: /repeat cancel ${job.id}`),
    '',
  );

  return lines.join('\n');
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest subcommand within edit distance ≤ 2.
 * Only triggers for single-word inputs that look like typos (short, no spaces).
 */
function findClosestSubcommand(input: string, subcommands: string[]): string | null {
  let best: string | null = null;
  let bestDist = 3; // threshold: must be ≤ 2
  for (const cmd of subcommands) {
    const dist = levenshtein(input, cmd);
    if (dist < bestDist) {
      bestDist = dist;
      best = cmd;
    }
  }
  return best;
}

function showUsage(): string {
  return `
${chalk.cyan('/repeat — Schedule a recurring prompt')}

${chalk.yellow('Usage:')}
  /repeat [interval] <prompt>     Schedule a recurring prompt
  /repeat list                    Show active jobs
  /repeat cancel <id>             Cancel a job

${chalk.yellow('Interval formats:')}
  5m       every 5 minutes
  2h       every 2 hours
  1d       every day
  30s      every 30 seconds (rounded to 1m)

${chalk.yellow('Examples:')}
  /repeat 5m run tests
  /repeat check the deploy every 20m
  /repeat run tests every 5 minutes
  /repeat 2h check build status
  /repeat list
  /repeat cancel abc123
`;
}
