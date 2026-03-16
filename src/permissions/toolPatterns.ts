import { minimatch } from 'minimatch';

export interface ToolPattern {
  kind: string;
  argument?: string;
}

export function parseToolPattern(pattern: string): ToolPattern {
  const match = pattern.match(/^([^(]+?)\s*\(\s*(.+?)\s*\)\s*$/);
  if (match) {
    return { kind: match[1]!.trim(), argument: match[2]!.trim() };
  }
  return { kind: pattern.trim() };
}

export function parseToolPatternList(input: string): ToolPattern[] {
  return input.split(',').map(s => parseToolPattern(s.trim())).filter(p => p.kind);
}

export function matchesToolPattern(
  pattern: ToolPattern,
  call: { kind: string; target: string },
): boolean {
  if (pattern.kind !== call.kind) return false;
  if (!pattern.argument) return true;

  const arg = pattern.argument;

  // Stem wildcard: "git:*" matches "git push" (starts with "git ") but not "gitea"
  if (arg.endsWith(':*')) {
    const stem = arg.slice(0, -2);
    return call.target === stem || call.target.startsWith(stem + ' ');
  }

  // URL domain matching
  if (pattern.kind === 'url') {
    try {
      const url = new URL(call.target);
      const domain = url.hostname;
      if (arg.startsWith('*.')) {
        return domain.endsWith(arg.slice(1));
      }
      return domain === arg || domain.endsWith('.' + arg);
    } catch {
      return call.target.includes(arg);
    }
  }

  // Exact match first (fast path)
  if (arg === call.target) return true;

  // Glob matching for file patterns
  if (arg.includes('*') || arg.includes('?')) {
    return minimatch(call.target, arg);
  }

  return false;
}
