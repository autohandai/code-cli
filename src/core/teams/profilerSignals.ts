/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure, testable helpers for ProjectProfiler's expanded signal detection.
 * All functions are deterministic and side-effect free so they can be unit
 * tested without touching the filesystem or network.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\b(?:sk|pk|rk|ak)_(?:live|test|prod)_[A-Za-z0-9]{16,}\b/, // Stripe-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\b(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)\b/, // Private key blocks
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,})\b/, // Slack tokens
  /\b(?:AIza[0-9A-Za-z_-]{20,})\b/, // Google API keys
];

/**
 * Count secret-like patterns across a map of file path → content.
 * Best-effort and low-severity by design: this is a signal for team
 * composition, not a secrets scanner.
 */
export function countSecretPatterns(files: ReadonlyMap<string, string>): number {
  let count = 0;
  for (const content of files.values()) {
    for (const pattern of SECRET_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
  }
  return count;
}

const EXPORT_PATTERN = /export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_IMPORT_PATTERN = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;

/**
 * Count exported symbols that are never referenced by any other file in the
 * map. A symbol is considered referenced when its name appears in another
 * file's named import list or as a bare identifier in another file.
 * Best-effort heuristic; false positives degrade to "no signal".
 */
export function countUnreferencedExports(files: ReadonlyMap<string, string>): number {
  const exported = new Map<string, string>(); // symbol -> file
  const referenced = new Set<string>();

  for (const [file, content] of files) {
    for (const match of content.matchAll(EXPORT_PATTERN)) {
      exported.set(match[1], file);
    }
  }

  for (const [file, content] of files) {
    for (const match of content.matchAll(NAMED_IMPORT_PATTERN)) {
      for (const name of match[1].split(',')) {
        const trimmed = name.trim().replace(/^.*\s+as\s+/, '');
        if (trimmed) referenced.add(trimmed);
      }
    }
    // Bare identifier references (best-effort): any word matching an export
    // name in a *different* file counts as a reference. The exporting file's
    // own declaration must not count as a self-reference.
    for (const symbol of exported.keys()) {
      if (exported.get(symbol) !== file && content.includes(symbol)) referenced.add(symbol);
    }
  }

  let count = 0;
  for (const [symbol] of exported) {
    if (!referenced.has(symbol)) count += 1;
  }
  return count;
}

/**
 * Count lint error lines from command output. Matches the common
 * `file:line:col error: message` shape used by eslint, tsc, and biome.
 */
export function parseLintOutput(output: string): number {
  const lines = output.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (/:\d+:\d+\s+(?:error|warning)\b/.test(line)) count += 1;
  }
  return count;
}

/**
 * Count outdated dependencies from `bun outdated --json` / `npm outdated --json`
 * output. Both emit a record of package name → { current, latest, ... }.
 */
export function parseOutdatedJson(json: string): number {
  try {
    const parsed = JSON.parse(json) as Record<string, { current?: string; latest?: string }>;
    let count = 0;
    for (const entry of Object.values(parsed)) {
      if (entry && typeof entry === 'object' && entry.latest && entry.current && entry.latest !== entry.current) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}